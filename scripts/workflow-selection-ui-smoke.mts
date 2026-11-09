// Reuse the actual JSON UI flow without changing Step22 defaults or overwriting its receipts.
// This entry opts into real two-workflow setup, explicit selection and distinct artifact names.
process.argv.push('--workflow-selection');
await import('./json-validation-ui-smoke.mts');
