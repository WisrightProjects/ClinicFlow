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
