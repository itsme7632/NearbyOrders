/**
 * Monetary values are integer PKR minor units (paisa); never use floating-point values.
 * PKR's minor unit is the paisa (1/100 rupee), so display divides by 100 —
 * a stored priceMinor of 65000 renders as "Rs 650", matching the seed/API data scale.
 */
export const MINOR_UNITS_PER_MAJOR = 100;
export const formatMoney = (minor: number, currency = 'PKR') =>
  new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(minor / MINOR_UNITS_PER_MAJOR);
