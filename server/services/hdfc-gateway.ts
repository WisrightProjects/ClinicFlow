// The only module that talks to HDFC SmartGateway. Creates payment sessions, reads
// authoritative order status, and authenticates incoming webhooks.
//
// Everything here is network I/O against a third party. No database access, no business
// decisions -- callers decide what a status means. See PAYMENT_FLOW_PLAN.md §13.

import crypto from 'crypto';

/**
 * Statuses meaning the payment is still in flight: decide nothing, ask again later.
 *
 * Lives here rather than in shared/ because this is the only module that speaks HDFC's
 * protocol, and shared/ is bundled into the client — which has no business knowing a
 * payment processor's status vocabulary.
 */
const PENDING_STATUSES = ['NEW', 'PENDING', 'PENDING_VBV', 'AUTHORIZING'] as const;

/** Order status as HDFC reports it. Only the fields we actually read. */
export interface HdfcOrderStatus {
  /** String status, e.g. "CHARGED". The authority on whether money moved. */
  status: string;
  /** HDFC's numeric equivalent, e.g. 21 for CHARGED. Logged, not branched on. */
  status_id: number;
  /** Our order id, echoed back. */
  order_id: string;
  /**
   * Amount as a JSON *number* (21), not a string ("21.00"). Comparing it as a string
   * rejects every valid payment, so callers must compare numerically.
   */
  amount: number;
  /** HDFC's own identifier for the order. Stored as our gatewayPaymentId. */
  id: string;
  /**
   * When HDFC stops accepting payment for this order. The sweep uses it to decide that
   * an abandoned checkout is genuinely dead, rather than guessing from elapsed time.
   */
  order_expiry?: string;
}

export interface HdfcSession {
  status: string;
  order_id: string;
  /** HDFC's order handle, e.g. "ordeh_...". */
  id: string;
  payment_links: { web: string; expiry?: string };
  sdk_payload?: unknown;
}

/** Thrown when HDFC is unreachable or answers with an error. Never swallowed silently. */
export class HdfcGatewayError extends Error {
  constructor(message: string, readonly httpStatus?: number, readonly errorCode?: string) {
    super(message);
    this.name = 'HdfcGatewayError';
  }
}

export class HdfcGateway {
  private get baseUrl(): string {
    return (process.env.HDFC_BASE_URL || '').replace(/\/+$/, '');
  }

  /**
   * True only when every credential needed to transact is present.
   *
   * This matters because the code ships to production while ONLINE_PAYMENT_MODE is still
   * 'dummy' and these variables are empty. Everything downstream must fail closed rather
   * than attempt a half-configured call.
   */
  isConfigured(): boolean {
    return Boolean(
      process.env.HDFC_API_KEY &&
        process.env.HDFC_MERCHANT_ID &&
        process.env.HDFC_PAYMENT_PAGE_CLIENT_ID &&
        this.baseUrl &&
        // Required explicitly, with no fallback. If a staging deployment forgets it, the
        // return_url would point at production: the patient pays, is sent to a host that
        // has never heard of their order, and the money is taken with nothing to show.
        // Refusing to enable the gateway is the safe failure.
        process.env.PUBLIC_BASE_URL &&
        // Included because verifyWebhookAuth rejects when either is unset. Without them
        // here, a deployment that set everything else would go live, 401 every webhook
        // with no startup warning, and quietly fall back to the slower sweep.
        process.env.HDFC_WEBHOOK_USER &&
        process.env.HDFC_WEBHOOK_PASS
    );
  }

  /**
   * Whether an inbound webhook request really came from HDFC.
   *
   * HDFC authenticates with HTTP Basic using a username and password we chose and typed
   * into their dashboard. Returns false when either side is unset -- an unconfigured
   * server must reject webhooks, not compare empty against empty and accept.
   */
  verifyWebhookAuth(authorizationHeader: string | undefined): boolean {
    const user = process.env.HDFC_WEBHOOK_USER || '';
    const pass = process.env.HDFC_WEBHOOK_PASS || '';
    if (!user || !pass) return false;
    if (!authorizationHeader?.startsWith('Basic ')) return false;

    const expected = Buffer.from(`${user}:${pass}`);
    const supplied = Buffer.from(
      Buffer.from(authorizationHeader.slice(6), 'base64').toString('utf8')
    );

    // Length check first: timingSafeEqual throws on a length mismatch. Lengths are not
    // secret, so leaking that difference is acceptable; the contents are compared in
    // constant time so a wrong password cannot be discovered byte by byte.
    if (expected.length !== supplied.length) return false;
    return crypto.timingSafeEqual(expected, supplied);
  }

  /**
   * An order id meeting HDFC's constraints: under 21 characters, alphanumeric, and
   * non-sequential. Sequential ids (e.g. a table's primary key) would let anyone
   * enumerate other merchants' and patients' orders, so this is random.
   *
   * 'CF' + 16 hex characters = 18.
   */
  generateOrderId(): string {
    return 'CF' + crypto.randomBytes(8).toString('hex');
  }

  private headers(customerId: string): Record<string, string> {
    // Docs: "Basic <Base64-encoded API key>" -- the bare key, with no trailing colon.
    const auth = 'Basic ' + Buffer.from(process.env.HDFC_API_KEY || '').toString('base64');
    return {
      Authorization: auth,
      'Content-Type': 'application/json',
      'x-merchantid': process.env.HDFC_MERCHANT_ID || '',
      'x-customerid': customerId,
      'x-resellerid': 'hdfc_reseller',
    };
  }

  /**
   * Opens a payment session and returns the hosted checkout URL to send the patient to.
   * Creating a session collects no money -- it only reserves an order on HDFC's side.
   */
  async createSession(params: {
    orderId: string;
    amount: number;
    customerId: string;
    customerEmail: string;
    customerPhone: string;
    returnUrl: string;
    description?: string;
  }): Promise<HdfcSession> {
    const body = {
      order_id: params.orderId,
      // HDFC wants a string with at most two decimals here, even though it returns a
      // number on the way back.
      amount: params.amount.toFixed(2),
      customer_id: params.customerId,
      customer_email: params.customerEmail,
      customer_phone: params.customerPhone,
      payment_page_client_id: process.env.HDFC_PAYMENT_PAGE_CLIENT_ID,
      action: 'paymentPage',
      return_url: params.returnUrl,
      currency: 'INR',
      description: params.description ?? 'Clinik booking fee',
    };

    const res = await this.request('POST', '/session', params.customerId, body);
    if (!res.payment_links?.web) {
      throw new HdfcGatewayError('Session created but no payment link was returned');
    }
    return res as HdfcSession;
  }

  /**
   * The authoritative answer on whether an order was paid.
   *
   * This is a server-to-server call authenticated with our API key, which is why it can
   * be trusted where a browser redirect or a webhook body cannot.
   */
  async getOrderStatus(orderId: string, customerId: string): Promise<HdfcOrderStatus> {
    const res = await this.request('GET', `/orders/${encodeURIComponent(orderId)}`, customerId);
    return res as HdfcOrderStatus;
  }

  /** Money was collected. The only status that may produce a booking. */
  isCharged(status: string): boolean {
    return status === 'CHARGED';
  }

  /** Still in flight -- decide nothing, ask again later. */
  isPending(status: string): boolean {
    return (PENDING_STATUSES as readonly string[]).includes(status);
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    customerId: string,
    body?: unknown
  ): Promise<Record<string, any>> {
    // Single configuration gate for every outbound call, so no public method can
    // half-attempt one against an unconfigured deployment.
    if (!this.isConfigured()) {
      throw new HdfcGatewayError('HDFC gateway is not configured');
    }

    const url = this.baseUrl + path;

    // A gateway that never answers must not hold a request open indefinitely -- the
    // patient is waiting on the other end of this.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: this.headers(customerId),
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      const reason = err instanceof Error && err.name === 'AbortError' ? 'timed out' : 'unreachable';
      throw new HdfcGatewayError(`HDFC ${method} ${path} ${reason}`);
    } finally {
      clearTimeout(timeout);
    }

    const text = await res.text();
    let json: Record<string, any>;
    try {
      json = JSON.parse(text);
    } catch {
      throw new HdfcGatewayError(
        `HDFC ${method} ${path} returned non-JSON (HTTP ${res.status})`,
        res.status
      );
    }

    if (!res.ok) {
      throw new HdfcGatewayError(
        `HDFC ${method} ${path} failed: ${json.error_message || json.status || 'unknown error'}`,
        res.status,
        json.error_code
      );
    }

    return json;
  }
}

export const hdfcGateway = new HdfcGateway();
