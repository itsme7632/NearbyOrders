import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'pk.nearbyorders.app',
  appName: 'NearbyOrders',
  webDir: 'dist',
  server: {
    androidScheme: 'http',
  },
};

export default config;
