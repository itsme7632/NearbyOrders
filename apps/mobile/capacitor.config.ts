import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'pk.nearbyorders.app',
  appName: 'NearbyOrders',
  webDir: 'dist',
  server: {
    androidScheme: 'http',
  },
  // No `plugins` block: the Android top inset is measured in JS at startup
  // (see src/statusBar.ts -> --native-statusbar-height -> --sat in
  // styles.css). NOTE: there is no "SystemBars" plugin installed in this
  // project — a plugins.SystemBars entry here would be dead config
  // referencing a nonexistent plugin, so do not re-add one.
};

export default config;
