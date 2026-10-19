# Agency Kit setup guide

The StackGrade Agency Kit is a **$29 one-time purchase** that unlocks a white-label audit widget for your website and white-label PDF reports for your clients. It takes about five minutes to set up. The same white-label features are included in the **Agency** ($49/month or $490/year) and **Agency+** ($99/month or $990/year) plans, which add daily monitoring of 200 or 1,000 domains; this guide works for those license keys too. See [pricing](https://299nhs7sjg-netizen.github.io/stackgrade/pricing/).

## 1. Buy the Agency Kit

Buy it through Stripe: [Get the Agency Kit, $29](https://buy.stripe.com/dRm7sN86d7ptfl4amCaR208). Stripe processes the payment and emails your receipt.

## 2. Find your license key

After checkout you return to a StackGrade page that shows your license key, with a copy button. It looks like `SG-KIT-XXXX-XXXX-XXXX-XXXX`. Save this key, it is your proof of purchase. The page shows it for 24 hours. Lost it? Email support@forthire.com with your Stripe receipt.

Bought earlier on Gumroad? Your key is in the Gumroad receipt email and your Gumroad library (gumroad.com/library). It looks like `XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX` and keeps working.

## 3. Activate it

Open the [agency widget page](https://299nhs7sjg-netizen.github.io/stackgrade/agency-widget/), paste the key into the **License key** box and click **Activate**. The page you return to after checkout activates the key in that browser for you. Elsewhere, your browser checks the key (Stripe keys with the StackGrade API, Gumroad keys with Gumroad); when it is accepted, the panel turns green and says "Agency Kit license active" (or "Agency license active"). A Pro key is accepted for monitoring but does not unlock white-label features.

## 4. Build your white-label widget

On the same page, fill in the widget builder:

- **Agency name** and **brand color**.
- **Logo URL**: a public `https://` link to your logo image (PNG or SVG, ideally about 40px tall).
- **Button text** and **button link**: for example "Book a free audit call" linking to your contact page.
- **Hide "Powered by StackGrade"**.
- **Collect leads** (optional): after the result, visitors see a short "Want help fixing this?" form (name, email, consent). Leads appear in the [monitoring dashboard](https://299nhs7sjg-netizen.github.io/stackgrade/app/) once you paste the same key there, and can be downloaded as CSV. The form links to the StackGrade [privacy policy](https://299nhs7sjg-netizen.github.io/stackgrade/privacy/).

The preview updates as you type. Click **Copy** and paste the snippet into your site where the widget should appear. The snippet contains your license key, which visitors can see in your page source, so only use it on your own sites.

## 5. Export white-label PDF reports

Grade any domain on the [StackGrade home page](https://299nhs7sjg-netizen.github.io/stackgrade/) (or any checker page), then click **White-label PDF report** under the result. Your browser's print dialog opens: choose **Save as PDF**. The report uses the logo, name and color you saved in the widget builder, and contains no StackGrade branding. To change the branding, edit it in the builder; it is saved in your browser.

## 6. Use it on more devices

Activation is stored in each browser's local storage. On another computer or browser, open the agency widget page and paste the same key again. Your branding settings are per browser too, so re-enter them there (or copy the snippet you already made). Clearing your browser's site data removes the activation; just paste the key again.

## Good to know

- The license is re-checked at most once a day. If the check cannot be reached, an activated browser stays unlocked for up to 7 days.
- A fully refunded Stripe purchase stops working at the next check. A cancelled Agency subscription keeps working until the end of the paid period. (Gumroad purchases: a refund, chargeback, dispute, failed payment or ended membership locks the key.)
- The white-label widget checks your key on every page load and falls back to the free, StackGrade-branded widget if the key is not valid.
- Questions or refunds: email support@forthire.com with your Stripe receipt (Gumroad purchases: contact the seller through the Gumroad product page). More answers in the [FAQ](https://299nhs7sjg-netizen.github.io/stackgrade/faq/).
