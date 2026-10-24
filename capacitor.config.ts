import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.wisright.clinikflow',
  appName: 'Clinik',
  webDir: 'dist/public',
  server: {
    androidScheme: 'https',
    // Load the live production site so relative /api calls hit the real backend
    url: 'https://clinik.co.in',
    cleartext: false,
    // Hosts the WebView may navigate to without handing off to the system browser.
    // The payment gateway MUST be here: without it Capacitor opens HDFC's checkout in
    // Chrome, and the patient is returned to Chrome rather than to the app — so the
    // booking completes somewhere they cannot see. Compiled into the APK, so changing
    // it requires a new build, not a web redeploy.
    //
    // Wildcards, not exact hosts. A UAT payment on a real device showed checkout running
    // on `gateway.hdfcuat.bank.in` — NOT the `smartgateway.` host the session API lives
    // on, which is why the first version of this list failed and the page opened in
    // Chrome. Checkout also hops onward to the issuing bank for net banking and to a
    // 3DS/ACS host for cards, so enumerating exact hostnames is not realistic.
    //
    // juspay is included because SmartGateway is Juspay-operated and parts of the
    // checkout are served from their domains.
    // Capacitor's HostMask matches exactly ONE label in place of the `*`, so
    // `*.hdfcuat.bank.in` covers `gateway.hdfcuat.bank.in` but not a deeper host. The
    // hosts actually observed in a UAT payment are therefore listed explicitly as well,
    // so the flow does not depend on the wildcard behaving as hoped.
    allowNavigation: [
      // Observed on a real device: checkout runs here, and the session API here.
      'gateway.hdfcuat.bank.in',
      'smartgateway.hdfcuat.bank.in',
      // The production equivalents, for when live credentials are issued.
      'gateway.hdfc.bank.in',
      'smartgateway.hdfc.bank.in',
      // Catch-alls for the onward hops — issuing bank, 3DS/ACS, Juspay-served assets.
      '*.hdfc.bank.in',
      '*.hdfcuat.bank.in',
      '*.hdfcbank.com',
      '*.juspay.in',
      '*.juspay.io',
    ],
  },
  plugins: {
    Geolocation: {
      requestPermissions: true,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
