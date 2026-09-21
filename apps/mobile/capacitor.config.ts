import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'pk.nearbyorders.app',
  appName: 'NearbyOrders',
  webDir: 'dist',
  server: {
    androidScheme: 'http',
  },
  plugins: {
    // Android WebView reports 0 for the CSS env(safe-area-inset-*) variables
    // (Chromium only maps display cutouts, not the status bar), so a pure-CSS
    // top inset can never clear the status bar on edge-to-edge devices. The
    // bundled SystemBars plugin injects the real native insets as
    // --safe-area-inset-* CSS variables; styles.css consumes them via a
    // var() -> env() fallback chain. LIGHT = dark status-bar content, which
    // matches the app's light header/auth surfaces.
    SystemBars: {
      insetsHandling: 'css',
      style: 'LIGHT',
    },
  },
};

export default config;
