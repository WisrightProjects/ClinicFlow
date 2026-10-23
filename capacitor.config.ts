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
    // ⚠️ INCOMPLETE — these two cover only the first hop. Net banking navigates to the
    // issuing bank's own domain and cards to a 3DS/ACS host, neither of which matches.
    // The real list has to be captured from an actual UAT payment on a device before
    // the AAB is built. See PAYMENT_FLOW_PLAN.md §16.1.
    allowNavigation: [
      'smartgateway.hdfcuat.bank.in',
      'smartgateway.hdfc.bank.in',
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
