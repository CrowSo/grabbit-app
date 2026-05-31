import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL     = Deno.env.get("APP_SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("APP_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY   = Deno.env.get("RESEND_API_KEY")!;

const FROM_EMAIL    = "Grabbit <noreply@appgrabbit.com>";
const DOWNLOAD_URL  = "https://github.com/CrowSo/grabbit-app/releases/latest/download/GrabbitSetup.exe";
const LANDING_URL   = "https://appgrabbit.com";
const SUPPORT_EMAIL = "support@appgrabbit.com";
const DISCORD_URL   = "https://discord.gg/QDcbsavQ";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const rand  = (n: number) =>
    Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `GRAB-${rand(4)}-${rand(4)}-${rand(4)}`;
}

function getDaysFromAmount(amountTotal: number): { days: number; plan: string } {
  if (amountTotal >= 5000) return { days: 365, plan: "pro_annual" };
  return { days: 30, plan: "pro" };
}

async function sendEmail(to: string, code: string, days: number, isRenewal: boolean) {
  const subject = isRenewal
    ? "Grabbit Pro · Your license has been renewed ✓"
    : "Grabbit Pro · Your license key is ready 🎉";

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#080c18;font-family:-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#080c18;padding:48px 20px;">
    <tr><td align="center"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
      <tr><td style="padding-bottom:32px;">
        <table cellpadding="0" cellspacing="0"><tr>
          <td style="background:#38bdf8;border-radius:12px;width:42px;height:42px;text-align:center;vertical-align:middle;">
            <span style="color:#fff;font-size:22px;font-weight:900;line-height:42px;">↓</span>
          </td>
          <td style="padding-left:12px;"><span style="font-size:1.4rem;font-weight:700;color:#e2e8f8;">Grab<span style="color:#7dd3fc;">bit</span></span></td>
        </tr></table>
      </td></tr>
      <tr><td style="background:#111827;border-radius:20px;border:1px solid rgba(56,189,248,0.1);padding:40px;">
        <div style="margin-bottom:20px;">
          <span style="background:rgba(56,189,248,0.12);color:#38bdf8;border:1px solid rgba(56,189,248,0.25);border-radius:99px;padding:4px 14px;font-size:0.78rem;font-weight:700;">PRO PLAN</span>
        </div>
        <h1 style="margin:0 0 10px;font-size:1.5rem;font-weight:800;color:#e2e8f8;">
          ${isRenewal ? "Your license has been renewed!" : "Welcome to Grabbit Pro!"}
        </h1>
        <p style="margin:0 0 28px;font-size:0.95rem;color:#7b8db0;line-height:1.7;">
          ${isRenewal
            ? `Your Pro license has been extended by <strong style="color:#e2e8f8;">${days} days</strong>. Use the same code below.`
            : `Thank you! Your activation code is ready. Keep it safe — works on any device.`}
        </p>
        <div style="background:#0e1224;border:2px dashed rgba(56,189,248,0.4);border-radius:14px;padding:24px;text-align:center;margin-bottom:28px;">
          <div style="font-size:0.72rem;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#4a5578;margin-bottom:10px;">Your license code</div>
          <div style="font-family:'Courier New',monospace;font-size:1.6rem;font-weight:700;letter-spacing:0.15em;color:#38bdf8;">${code}</div>
          <div style="font-size:0.75rem;color:#4a5578;margin-top:10px;">Valid for ${days} days · Unlimited downloads</div>
        </div>
        ${!isRenewal ? `
        <div style="text-align:center;margin-bottom:28px;">
          <a href="${DOWNLOAD_URL}" style="display:inline-block;background:#38bdf8;color:#fff;text-decoration:none;padding:14px 32px;border-radius:99px;font-size:0.95rem;font-weight:700;">
            ↓ Download Grabbit for Windows
          </a>
          <div style="font-size:0.75rem;color:#4a5578;margin-top:10px;">Free installer · No Python required · ~75 MB</div>
        </div>` : ''}
        <div style="background:#0e1224;border-radius:12px;padding:20px 24px;margin-bottom:24px;">
          <div style="font-size:0.78rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#4a5578;margin-bottom:14px;">How to activate</div>
          <table cellpadding="0" cellspacing="0" width="100%">
            ${["Open <strong style='color:#e2e8f8;'>Grabbit</strong> on your PC",
               "Go to <strong style='color:#e2e8f8;'>License</strong> in the sidebar",
               "Paste your code and click <strong style='color:#e2e8f8;'>Activate</strong>",
               "Enjoy <strong style='color:#e2e8f8;'>" + days + " days</strong> of unlimited Pro access"].map((step, i) => `
            <tr>
              <td style="vertical-align:top;width:28px;padding-bottom:10px;">
                <span style="display:inline-block;width:22px;height:22px;border-radius:50%;background:rgba(56,189,248,0.12);border:1px solid rgba(56,189,248,0.3);color:#38bdf8;font-size:0.72rem;font-weight:700;text-align:center;line-height:22px;">${i+1}</span>
              </td>
              <td style="vertical-align:top;padding-left:10px;padding-bottom:10px;">
                <span style="font-size:0.88rem;color:#7b8db0;line-height:1.5;">${step}</span>
              </td>
            </tr>`).join('')}
          </table>
        </div>
        <p style="margin:0 0 24px;font-size:0.88rem;color:#7b8db0;line-height:1.7;background:rgba(34,197,94,0.05);border:1px solid rgba(34,197,94,0.15);border-radius:10px;padding:14px 18px;">
          <strong style="color:#22c55e;">✓ Active now</strong> — Valid for <strong style="color:#e2e8f8;">${days} days</strong>. Renew anytime from the License section in Grabbit.
        </p>
        <table cellpadding="0" cellspacing="0" width="100%"><tr><td style="text-align:center;">
          <a href="${LANDING_URL}" style="color:#38bdf8;text-decoration:none;font-size:0.82rem;margin:0 12px;">Website</a>
          <a href="${DISCORD_URL}" style="color:#38bdf8;text-decoration:none;font-size:0.82rem;margin:0 12px;">Discord</a>
          <a href="mailto:${SUPPORT_EMAIL}" style="color:#38bdf8;text-decoration:none;font-size:0.82rem;margin:0 12px;">Support</a>
        </td></tr></table>
      </td></tr>
      <tr><td style="padding-top:24px;text-align:center;">
        <p style="margin:0;font-size:0.75rem;color:#4a5578;line-height:1.7;">
          Grabbit · appgrabbit.com<br/>
          <a href="mailto:${SUPPORT_EMAIL}" style="color:#38bdf8;text-decoration:none;">${SUPPORT_EMAIL}</a>
        </p>
      </td></tr>
    </table></td></tr>
  </table>
</body></html>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error("Resend error:", err);
    throw new Error(`Email failed: ${err}`);
  }
}

serve(async (req) => {
  if (req.method === "GET") {
    return new Response(JSON.stringify({ status: "ok" }), { headers: { "Content-Type": "application/json" } });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const event     = await req.json();
    const eventType = event.type;
    console.log("Stripe event:", eventType);

    // Skip payment_intent.succeeded — always duplicates checkout/invoice events
    if (eventType === "payment_intent.succeeded") {
      console.log("Skipping payment_intent.succeeded — duplicate prevention");
      return new Response(JSON.stringify({ received: true, skipped: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // For invoice.payment_succeeded on a new subscription, Stripe also fires
    // checkout.session.completed — skip the invoice event to avoid creating duplicate licenses.
    // Only process invoice.payment_succeeded for real renewals (subscription_cycle).
    if (eventType === "invoice.payment_succeeded") {
      const billingReason = event.data?.object?.billing_reason;
      if (billingReason === "subscription_create") {
        console.log("Skipping invoice.payment_succeeded (subscription_create) — checkout.session.completed handles this");
        return new Response(JSON.stringify({ received: true, skipped: true }), {
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    if (
      eventType === "checkout.session.completed" ||
      eventType === "invoice.payment_succeeded"
    ) {
      const obj = event.data?.object || {};
      const customerEmail =
        obj.customer_details?.email || obj.customer_email || obj.receipt_email || null;
      const customerName     = obj.customer_details?.name || null;
      const stripeCustomerId = obj.customer || null;
      const amountTotal      = obj.amount_total || obj.amount_paid || 0;

      if (!customerEmail) {
        console.error("No email in event");
        return new Response("No email found", { status: 400 });
      }

      const email = customerEmail.toLowerCase().trim();

      // Idempotency — skip if a license was created for this email in the last 5 minutes
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data: recentLicense } = await supabase
        .from("licenses")
        .select("id")
        .eq("email", email)
        .gte("created_at", fiveMinutesAgo)
        .maybeSingle();

      if (recentLicense) {
        console.log(`Duplicate event for ${email} within 5 min — skipping`);
        return new Response(JSON.stringify({ received: true, duplicate: true }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      const { days: DAYS, plan: PLAN } = getDaysFromAmount(amountTotal);
      console.log(`Amount: ${amountTotal} cents → ${DAYS} days (${PLAN})`);

      const { data: existing } = await supabase
        .from("licenses")
        .select("*")
        .eq("email", email)
        .maybeSingle();

      let code: string;
      let isRenewal = false;

      if (existing) {
        isRenewal     = true;
        code          = existing.code;
        const newDays = (existing.days_left || 0) + DAYS;

        await supabase
          .from("licenses")
          .update({
            days_left:          newDays,
            is_active:          true,
            plan:               PLAN,
            last_renewed_at:    new Date().toISOString(),
            stripe_customer_id: stripeCustomerId || existing.stripe_customer_id,
          })
          .eq("email", email);

        console.log(`Renewed ${email}: +${DAYS} days → ${newDays} total (${PLAN})`);
      } else {
        let attempts = 0;
        code = generateCode();
        while (attempts < 10) {
          const { data: collision } = await supabase
            .from("licenses").select("code").eq("code", code).maybeSingle();
          if (!collision) break;
          code = generateCode();
          attempts++;
        }

        await supabase.from("licenses").insert({
          code,
          email,
          days_left:          DAYS,
          is_active:          true,
          plan:               PLAN,
          stripe_customer_id: stripeCustomerId,
          notes:              customerName ? `Customer: ${customerName}` : null,
        });

        console.log(`New license ${email}: ${code} → ${DAYS} days (${PLAN})`);
      }

      await sendEmail(email, code, DAYS, isRenewal);
      console.log(`Email sent to ${email}`);

      return new Response(
        JSON.stringify({ success: true, email, code, renewal: isRenewal, days: DAYS, plan: PLAN }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });

  } catch (err) {
    console.error("Edge Function error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
