import type { ReactNode } from 'react';
import { Button } from '../components/ui.js';

const SUPPORT_EMAIL = 'info@nearbyorders.com';
const LAST_UPDATED = 'October 7, 2026';

function ScreenHead(props: { title: string; sub?: string }) {
  return (
    <header className="owner-head saved-head">
      <div>
        <h1>{props.title}</h1>
        {props.sub ? <p className="saved-head-sub">{props.sub}</p> : null}
      </div>
    </header>
  );
}

function InfoPage(props: { title: string; sub?: string; children: ReactNode; onBack: () => void }) {
  return (
    <div className="screen">
      <ScreenHead title={props.title} sub={props.sub} />
      <div className="info-card">{props.children}</div>
      <Button full variant="ghost" onClick={props.onBack}>
        Back
      </Button>
    </div>
  );
}

function SupportLink(props: { children?: ReactNode }) {
  return (
    <a
      href={`mailto:${SUPPORT_EMAIL}`}
      style={{ color: '#16222E', fontWeight: 800, textDecoration: 'underline' }}
    >
      {props.children ?? 'Contact NearbyOrders'}
    </a>
  );
}

function Section(props: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginTop: 22 }}>
      <h2 style={{ margin: '0 0 8px', fontSize: 18, lineHeight: 1.25, color: '#16222E' }}>{props.title}</h2>
      <div style={{ color: '#40515D', fontSize: 14, lineHeight: 1.7 }}>{props.children}</div>
    </section>
  );
}

function FAQ(props: { question: string; children: ReactNode }) {
  return (
    <details style={{ borderTop: '1px solid #DCE2E7', padding: '12px 0' }}>
      <summary style={{ cursor: 'pointer', fontWeight: 800, color: '#16222E' }}>{props.question}</summary>
      <div style={{ paddingTop: 8, color: '#40515D', lineHeight: 1.65 }}>{props.children}</div>
    </details>
  );
}

export function HelpScreen(props: { onBack: () => void }) {
  return (
    <InfoPage title="Help & support" sub="Answers for orders, bookings, payments and your account" onBack={props.onBack}>
      <p style={{ marginTop: 0 }}>
        NearbyOrders connects customers with nearby businesses for products, pickup, delivery and services. Start with the
        answers below. If you still need help, our team can be reached directly at <SupportLink>{SUPPORT_EMAIL}</SupportLink>.
      </p>

      <Section title="Orders">
        <FAQ question="How do I place an order?">Open a business, choose the products you want, review your cart, select pickup or delivery, choose the available payment method, and place the order.</FAQ>
        <FAQ question="How do I know what is happening with my order?">Open the order from My Orders. The order status and payment state are shown there. Push notifications may also alert you when the business or delivery status changes.</FAQ>
        <FAQ question="Can I cancel an order?">Cancellation depends on the current order state and the business workflow. If cancellation is available, use the action shown on the order. If you cannot cancel it, contact the business or NearbyOrders for help.</FAQ>
        <FAQ question="How does pickup work?">Choose Pickup during checkout. The business will provide the order status and pickup readiness through the order flow. Pickup orders do not require a delivery address or rider.</FAQ>
        <FAQ question="How does delivery work?">Choose Delivery and select a saved or new delivery address. Once the order is accepted and a rider is assigned, the relevant delivery information is shown in the order.</FAQ>
      </Section>

      <Section title="Payments">
        <FAQ question="How do online payments work?">If the order uses an online payment method, the order shows the exact payment method selected for that order and the instructions required to submit payment proof.</FAQ>
        <FAQ question="What happens after I submit payment proof?">The proof enters a verification state. You do not need to submit it again while it is waiting for verification. Once the business verifies it, the order shows the paid state.</FAQ>
        <FAQ question="Why was my payment proof rejected?">The business may reject proof when it cannot verify the payment. The order will show the rejection reason and, when resubmission is available, you can submit new proof using the supported payment method.
        </FAQ>
        <FAQ question="How does Cash on Delivery work?">For a Cash on Delivery order, you pay the rider or business according to the order workflow. Online payment proof is not required for COD orders.</FAQ>
      </Section>

      <Section title="Bookings & services">
        <FAQ question="How do I book a service?">Open a business offering services, choose the service, select an available time slot, provide the requested details, and submit the booking.</FAQ>
        <FAQ question="What happens after I request a booking?">The booking remains pending until the business accepts or rejects it. You can open the booking to see the latest state.</FAQ>
        <FAQ question="Can I change a booking?">Available changes depend on the booking state and business workflow. If an edit option is not available, contact the business or NearbyOrders.</FAQ>
      </Section>

      <Section title="Account & security">
        <FAQ question="How do I verify my email?">After registration, NearbyOrders sends a six-digit verification code. Enter it on the verification screen. The code expires after 10 minutes.</FAQ>
        <FAQ question="I forgot my password. What should I do?">Use Forgot password on the sign-in screen. Enter your email, use the six-digit reset code sent to you, and choose a new password.</FAQ>
        <FAQ question="How do I change my password?">Open your Profile and choose Change password while signed in. If you cannot sign in, use Forgot password instead.</FAQ>
      </Section>

      <Section title="Still need help?">
        <p style={{ margin: 0 }}>Email us at <SupportLink>{SUPPORT_EMAIL}</SupportLink>. Please include your order or booking ID when your question is about a specific transaction.</p>
      </Section>
    </InfoPage>
  );
}

export function TermsScreen(props: { onBack: () => void }) {
  return (
    <InfoPage title="Terms & conditions" sub={`Last updated ${LAST_UPDATED}`} onBack={props.onBack}>
      <p style={{ marginTop: 0 }}>
        These Terms & Conditions govern your use of the NearbyOrders application and related services. By creating an account,
        accessing the app, placing an order, making a booking, or using a business account, you agree to these terms.
      </p>

      <Section title="1. About NearbyOrders">
        <p>NearbyOrders provides a platform that helps customers discover nearby businesses and lets participating businesses offer products and services for pickup, delivery, or booking. A business may set its own products, prices, availability, service details, and operating rules.</p>
      </Section>
      <Section title="2. Eligibility and accounts">
        <p>You must provide accurate account information and keep your login credentials confidential. You are responsible for activity performed through your account. You must not create an account using another person's identity or provide information that you know is false or misleading.</p>
      </Section>
      <Section title="3. Customer responsibilities">
        <p>Customers must provide accurate contact and delivery information, review order details before submitting an order, follow applicable payment instructions, and treat businesses, riders, and other users respectfully.</p>
      </Section>
      <Section title="4. Business responsibilities">
        <p>Businesses are responsible for the accuracy of their listings, product or service descriptions, prices, availability, operating hours, and fulfillment of accepted orders or bookings. Businesses must not publish unlawful, deceptive, unsafe, or misleading content.</p>
      </Section>
      <Section title="5. Orders, pickup and delivery">
        <p>An order request is not necessarily an acceptance by the business. The order becomes subject to the business workflow shown in the app. Delivery times can change because of business preparation, rider availability, traffic, weather, or other circumstances outside the platform's direct control.</p>
        <p>For pickup orders, the customer is responsible for collecting the order according to the business instructions. Delivery orders require an accurate delivery address and contact details.</p>
      </Section>
      <Section title="6. Payments">
        <p>Payment methods shown at checkout are determined by the order and the business configuration. If online payment proof is required, the customer must submit accurate proof through the app. Cash on Delivery orders follow the cash collection workflow shown by the app.</p>
        <p>NearbyOrders does not ask users to share passwords, one-time verification codes, or account credentials as payment proof. Users should only follow payment instructions presented through the official order flow.</p>
      </Section>
      <Section title="7. Refunds and cancellations">
        <p>Refund eligibility depends on the order state, payment state, applicable business policy, and the reason for cancellation or rejection. Where the app provides a refund or cancellation action, its displayed conditions apply. A completed refund is recorded separately from gross order revenue.</p>
      </Section>
      <Section title="8. Service bookings">
        <p>Businesses control their available services and appointment slots. A booking request may remain pending until accepted. Customers and businesses must honor accepted booking commitments or communicate promptly when a change is necessary.</p>
      </Section>
      <Section title="9. Reviews and user content">
        <p>Reviews and other content submitted by users must be truthful, relevant, and lawful. Do not upload content that infringes another person's rights, contains malicious code, impersonates someone else, or is abusive or fraudulent. NearbyOrders may remove content that violates these terms or applicable law.</p>
      </Section>
      <Section title="10. Prohibited use">
        <p>You must not misuse the platform, attempt unauthorized access, interfere with app or API operation, manipulate orders or reviews, use another person's payment information without authorization, scrape protected data, or use NearbyOrders for unlawful activity.</p>
      </Section>
      <Section title="11. Account suspension and termination">
        <p>We may restrict, suspend, or terminate access where necessary to protect users, businesses, the platform, or comply with law. Where practical, we will provide an explanation and an appropriate opportunity to resolve the issue.</p>
      </Section>
      <Section title="12. Intellectual property">
        <p>NearbyOrders branding, software, interface design, and platform content are protected by applicable intellectual property laws. Businesses and users retain rights in content they own, while granting the permissions reasonably required to display that content through the platform.</p>
      </Section>
      <Section title="13. Third-party services">
        <p>NearbyOrders may rely on third-party services for infrastructure, email delivery, maps, notifications, payments, analytics, or other platform functions. Those services may have their own terms and privacy policies.</p>
      </Section>
      <Section title="14. Availability and disclaimers">
        <p>We work to keep NearbyOrders reliable, but the service may occasionally be unavailable because of maintenance, network issues, third-party outages, or other events. Business products, services, prices, and fulfillment are the responsibility of the relevant business.</p>
      </Section>
      <Section title="15. Changes to these terms">
        <p>We may update these terms as the platform evolves or legal requirements change. The latest version and its update date will be shown in the app. Continued use after an update means you accept the revised terms to the extent permitted by law.</p>
      </Section>
      <Section title="16. Contact">
        <p>Questions about these terms can be sent to <SupportLink>{SUPPORT_EMAIL}</SupportLink>.</p>
      </Section>
    </InfoPage>
  );
}

export function PrivacyScreen(props: { onBack: () => void }) {
  return (
    <InfoPage title="Privacy policy" sub={`Last updated ${LAST_UPDATED}`} onBack={props.onBack}>
      <p style={{ marginTop: 0 }}>
        This Privacy Policy explains how NearbyOrders handles information when you use the app and related services.
      </p>

      <Section title="1. Information you provide">
        <p>Depending on how you use NearbyOrders, this can include your first name, last name, email address, phone number, password credentials, delivery addresses, saved businesses, reviews, order details, booking details, and information submitted to a business through an order or booking.</p>
      </Section>
      <Section title="2. Information created by your activity">
        <p>We create and store records needed to operate the platform, such as order and booking status, payment state, notification records, account verification state, and security events associated with your account.</p>
      </Section>
      <Section title="3. Payment information">
        <p>NearbyOrders may store payment method selections, payment status, transaction references, and payment proof submitted through the app when required by a business workflow. Do not submit passwords, one-time codes, or unrelated sensitive information as payment proof.</p>
      </Section>
      <Section title="4. Delivery and location information">
        <p>When you place a delivery order, we use the delivery address and related contact information needed to fulfill that order. If you choose to save a map pin, its coordinates are stored with that saved address so the location can be used for delivery. NearbyOrders does not need continuous background location access simply to place an order.</p>
      </Section>
      <Section title="5. Device and technical information">
        <p>The app may process technical information required to provide secure sessions, notifications, diagnostics, and reliable operation. Push notification device tokens are used to deliver notifications to your registered devices.</p>
      </Section>
      <Section title="6. How we use information">
        <p>We use information to create and secure accounts, verify email addresses, process orders and bookings, coordinate delivery and pickup workflows, process payment-related states, send transactional notifications and emails, provide customer support, prevent abuse, maintain security, and improve the service.</p>
      </Section>
      <Section title="7. When information is shared">
        <p>We share information with the business involved in your order or booking when that information is needed to fulfill the transaction. For delivery, relevant information may also be made available to the assigned rider through the business workflow. We may use service providers for infrastructure, email, notifications, hosting, maps, payments, and other operational functions.</p>
      </Section>
      <Section title="8. Account security">
        <p>Passwords are stored using one-way password hashing rather than plain text. Authentication sessions use secure server-side mechanisms. You should keep your password and verification codes private and contact us if you believe your account has been compromised.</p>
      </Section>
      <Section title="9. Email and notifications">
        <p>We send transactional emails such as email verification, password reset, password change, and account welcome messages. Push notifications can include order, booking, payment, and other account updates. You can manage notification preferences provided by the app and your device.</p>
      </Section>
      <Section title="10. Retention">
        <p>We retain information for as long as reasonably necessary to provide the service, maintain transaction records, protect users and the platform, resolve disputes, comply with legal obligations, and enforce our agreements. Retention periods can differ by data type.</p>
      </Section>
      <Section title="11. Your choices and rights">
        <p>Depending on applicable law, you may have rights to access, correct, delete, or otherwise control certain personal information. You can update supported profile and address information from the app. For requests that cannot be completed in the app, contact <SupportLink>{SUPPORT_EMAIL}</SupportLink>.</p>
      </Section>
      <Section title="12. Account deletion">
        <p>If you want to request account deletion or have a privacy question, contact <SupportLink>{SUPPORT_EMAIL}</SupportLink>. Some information may need to be retained where required by law or reasonably necessary for legitimate security, accounting, fraud prevention, or dispute-resolution purposes.</p>
      </Section>
      <Section title="13. Children">
        <p>NearbyOrders is not intended for children who are not legally permitted to use marketplace or payment services. We do not knowingly request unnecessary personal information from children.</p>
      </Section>
      <Section title="14. Changes to this policy">
        <p>We may update this policy as the platform, services, or legal requirements change. The latest version and update date will be shown in the app.</p>
      </Section>
      <Section title="15. Contact us">
        <p>For privacy questions or requests, email <SupportLink>{SUPPORT_EMAIL}</SupportLink>.</p>
      </Section>
    </InfoPage>
  );
}

export function AboutScreen(props: { onBack: () => void }) {
  return (
    <InfoPage title="About NearbyOrders" sub="Local commerce, built for real neighborhoods" onBack={props.onBack}>
      <p style={{ marginTop: 0, fontSize: 17, fontWeight: 800, color: '#16222E' }}>
        Find nearby. Book or order.
      </p>
      <p>
        NearbyOrders is a mobile-first local marketplace that connects customers with nearby businesses for products,
        pickup, delivery, and services. The goal is simple: make local commerce easier to discover, order from, book, and manage.
      </p>

      <Section title="For customers">
        <p>Discover nearby businesses, explore products and services, save places you like, place pickup or delivery orders, book available services, manage delivery addresses, follow order and booking status, and receive important updates.</p>
      </Section>
      <Section title="For businesses">
        <p>Businesses can present their products and services, receive orders, manage fulfillment, handle bookings, configure payment workflows, coordinate riders, and keep customers informed.</p>
      </Section>
      <Section title="Built around trust">
        <p>NearbyOrders uses verified email accounts, clear order and payment states, transactional notifications, and explicit payment-proof workflows so customers and businesses can understand what is happening at each step.</p>
      </Section>
      <Section title="Our approach">
        <p>We are building NearbyOrders around local businesses and real neighborhood needs, with a focus on straightforward experiences rather than unnecessary complexity.</p>
      </Section>
      <Section title="Support">
        <p>Have a question, feedback, or need help with an order or booking? <SupportLink>Email the NearbyOrders team at {SUPPORT_EMAIL}</SupportLink>.</p>
      </Section>
      <Section title="App information">
        <p style={{ marginBottom: 0 }}>NearbyOrders · Sheikhupura, Pakistan</p>
      </Section>
    </InfoPage>
  );
}
