// Payment response page: what the patient sees when HDFC sends them back.
//
// Required by HDFC's security audit, which asks that the response page show the order
// number, the amount and a success message in real time, matching what the gateway's own
// page displayed. The browser carries only ?order_id=; every figure here is read back from
// the settled payment row, because a receipt that trusts its own URL could be edited by
// the patient into claiming any amount.

import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { CheckCircle2, Clock, XCircle, Receipt, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

interface PaymentReceipt {
  orderId: string;
  gatewayPaymentId: string | null;
  amount: string;
  platformFee: string;
  gstAmount: string;
  status: string;
  paidAt: string | null;
  creditedToWallet: boolean;
  appointment: {
    id: number;
    tokenNumber: number | null;
    date: string | null;
    doctorName: string | null;
    status: string | null;
  } | null;
}

const rupees = (value: string | null | undefined) =>
  `₹${parseFloat(String(value ?? "0")).toFixed(2)}`;

export default function PaymentReceiptPage() {
  const orderId = new URLSearchParams(window.location.search).get("order_id") ?? "";

  // Encoded: the default queryFn fetches queryKey[0] verbatim, so an unescaped id could
  // normalise the path to a different same-origin endpoint and render its JSON as a
  // receipt. On the one page whose whole point is not trusting its own URL, that will not do.
  const { data, isLoading, isError } = useQuery<PaymentReceipt>({
    queryKey: [`/api/payments/receipt/${encodeURIComponent(orderId)}`],
    enabled: !!orderId,
  });

  if (!orderId) {
    return <Message title="No payment to show" body="This page needs a payment to display." />;
  }

  if (isLoading) {
    return (
      <div className="max-w-md mx-auto p-4">
        <Card>
          <CardContent className="p-6 space-y-4">
            <Skeleton className="h-12 w-12 rounded-full mx-auto" />
            <Skeleton className="h-5 w-40 mx-auto" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isError || !data) {
    return (
      // Neutral on purpose. This page is only reached once a payment SUCCEEDED, so a failed
      // fetch means the receipt did not load -- not that the money bounced. Saying it will
      // be returned is what makes a patient who already has a token pay for a second one.
      <Message
        title="We could not load this receipt"
        body="Your payment went through. Open My Appointments to see your token."
      />
    );
  }

  // 'created' means the gateway has not given a final answer yet — not a failure. Saying
  // "failed" here is what makes a patient pay a second time for the same token.
  //
  // And 'success' means the money is ACCOUNTED FOR, not that a token exists. When the
  // charged amount does not match, or the booking fails after payment, the money goes to
  // the wallet and the row stays 'success' with no appointment. Claiming "your appointment
  // is confirmed" there sends the patient looking for a token that was never created — and
  // a receipt that disagrees with what the gateway did is the one thing this page exists
  // to prevent.
  const cancelled =
    data.appointment?.status === "cancel" || data.appointment?.status === "expired";
  const booked = data.status === "success" && !!data.appointment && !cancelled;
  // From the payment's own wallet transaction, not from a missing appointment — which is
  // also what a stranded payment waiting on the sweep looks like.
  const creditedToWallet = data.status === "success" && data.creditedToWallet;
  const pending = data.status === "created";

  // Flat and ordered, not a ternary chain: the branches are mutually exclusive and the
  // ORDER is the logic. Cancelled outranks booked so a reopened receipt stops claiming a
  // live token; pending outranks the failure copy so an unfinished 3DS is never reported
  // as a failure, which is what makes a patient pay twice.
  const view = (() => {
    if (cancelled)
      return {
        icon: <XCircle className="h-12 w-12 text-muted-foreground mx-auto" />,
        title: "This appointment was cancelled",
        body: "The payment below was made for a booking you have since cancelled.",
      };
    if (booked)
      return {
        icon: <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto" />,
        title: "Payment Successful",
        body: "Your appointment is confirmed.",
      };
    if (creditedToWallet)
      return {
        icon: <Wallet className="h-12 w-12 text-blue-600 mx-auto" />,
        title: "Payment received — credited to your wallet",
        body: "No token was booked, so this amount is in your Clinik wallet and can be used for your next booking.",
      };
    if (pending)
      return {
        icon: <Clock className="h-12 w-12 text-amber-500 mx-auto" />,
        title: "Payment is still processing",
        body: "Your bank has not confirmed yet. You will not be charged twice.",
      };
    return {
      icon: <XCircle className="h-12 w-12 text-red-600 mx-auto" />,
      title: "Payment was not completed",
      body: "No token was booked. Any amount debited will be returned to your wallet.",
    };
  })();

  return (
    <div className="max-w-md mx-auto p-4">
      <Card>
        <CardContent className="p-6 space-y-5">
          <div className="text-center space-y-2">
            {view.icon}
            <h1 className="text-xl font-semibold">{view.title}</h1>
            <p className="text-sm text-muted-foreground">{view.body}</p>
          </div>

          <Separator />

          {/* Order number and amount: the two values the audit checks against HDFC's own page. */}
          <div className="space-y-2 text-sm">
            <Row label="Order Number" value={<span className="font-mono">{data.orderId}</span>} />
            {data.gatewayPaymentId && (
              <Row
                label="Gateway Reference"
                value={<span className="font-mono text-xs">{data.gatewayPaymentId}</span>}
              />
            )}
            <Row label="Amount Paid" value={<span className="font-semibold">{rupees(data.amount)}</span>} />
            <Row label="Platform Fee" value={rupees(data.platformFee)} muted />
            <Row label="GST" value={rupees(data.gstAmount)} muted />
            {data.paidAt && (
              <Row label="Date" value={new Date(data.paidAt).toLocaleString("en-IN")} muted />
            )}
          </div>

          {data.appointment && (
            <>
              <Separator />
              <div className="space-y-2 text-sm">
                {data.appointment.tokenNumber != null && (
                  <Row
                    label="Token Number"
                    value={<span className="font-semibold">#{data.appointment.tokenNumber}</span>}
                  />
                )}
                {data.appointment.doctorName && (
                  <Row label="Doctor" value={data.appointment.doctorName} />
                )}
              </div>
            </>
          )}

          <Button asChild className="w-full">
            <Link href={creditedToWallet ? "/patient/wallet" : "/appointments"}>
              {creditedToWallet ? "View My Wallet" : "View My Appointments"}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: ReactNode;
  muted?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className={muted ? "text-muted-foreground" : ""}>{value}</span>
    </div>
  );
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div className="max-w-md mx-auto p-4">
      <Card>
        <CardContent className="p-6 text-center space-y-3">
          <Receipt className="h-10 w-10 text-muted-foreground mx-auto" />
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">{body}</p>
          <Button asChild variant="outline" className="w-full">
            <Link href="/appointments">Go to My Appointments</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
