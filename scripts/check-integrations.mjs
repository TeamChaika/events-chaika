import { checkMerchant } from "../server/qrm.mjs";
import { checkSmsAero, smsAeroReady } from "../server/smsaero.mjs";

// Read-only checks: no payment operations or messages are created.
if (process.env.QRM_MODE && process.env.QRM_MODE !== "disabled") {
  try {
    const merchant = await checkMerchant(process.env.QRM_MODE);
    console.log(
      JSON.stringify({
        provider: "QRM",
        ready: true,
        mode: process.env.QRM_MODE,
        firm: merchant.firm_name,
        subscriptionEnd: merchant.subscription_end_date,
        receipts: merchant.requires_receipt,
      }),
    );
  } catch {
    console.error(
      "QRM: terminal check failed; verify server settings and subscription.",
    );
    process.exitCode = 1;
  }
} else console.log("QRM: not configured");
if (smsAeroReady()) {
  try {
    await checkSmsAero();
    console.log("SMS Aero: authorization confirmed");
  } catch {
    console.error("SMS Aero: authorization failed");
    process.exitCode = 1;
  }
} else console.log("SMS Aero: email, API key or sender name is missing");
