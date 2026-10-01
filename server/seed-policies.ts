import { db } from './db';
import { adminConfigurations } from '@shared/schema';
import { eq } from 'drizzle-orm';

const policies = [
  {
    configKey: 'policy_terms_conditions',
    configValue: `<h1>Terms & Conditions</h1>
<p>By using ClinicFlow, you agree to the following terms and conditions.</p>

<h2>1. Eligibility</h2>
<ul>
<li>Users must be 18 years or older</li>
<li>Users under 18 must register with parent/guardian consent</li>
</ul>

<h2>2. Account Use</h2>
<ul>
<li>Keep login credentials confidential</li>
<li>You are responsible for all actions under your account</li>
<li><strong>Warning:</strong> Misuse (fake bookings, multiple no-shows, fraudulent activity) may lead to account suspension</li>
</ul>

<h2>3. Token Booking</h2>
<ul>
<li>Token bookings are subject to hospital/doctor availability</li>
<li>Bookings confirmed only after successful payment</li>
<li>Tokens are non-transferable and cannot be resold</li>
</ul>

<h2>4. Hospital & Doctor Responsibility</h2>
<p>Hospitals/doctors manage schedules, consultation delays, and cancellations. ClinicFlow is <strong>not liable</strong> for medical services, delays, or outcomes.</p>

<h2>5. Platform Rights</h2>
<ul>
<li>We may suspend accounts that violate our policies</li>
<li>Terms may be updated; continued use means you accept updates</li>
</ul>`,
    configType: 'string',
    description: 'Terms and Conditions policy content',
    category: 'policy',
    isEditable: true
  },
  {
    configKey: 'policy_privacy',
    configValue: `<h1>Privacy Policy</h1>
<p>Your privacy is important to us. This policy explains how we collect, use, and protect your information.</p>

<h2>1. Information We Collect</h2>
<ul>
<li><strong>Personal Information:</strong> Name, age, gender, contact details</li>
<li><strong>Booking Information:</strong> Hospital, doctor, token number, date/time</li>
<li><strong>App Usage:</strong> Preferences, notifications</li>
<li><strong>Location (Optional):</strong> Used for travel-time reminders if enabled</li>
</ul>

<h2>2. Use of Data</h2>
<ul>
<li>To process bookings and payments</li>
<li>To send token and schedule updates</li>
<li>To improve app experience</li>
<li>To provide customer support</li>
</ul>

<h2>3. Data Sharing</h2>
<ul>
<li>Shared only with hospitals/doctors you book</li>
<li>Never sold to third parties</li>
<li>May be shared if legally required</li>
</ul>

<h2>4. Security</h2>
<ul>
<li>Encrypted storage and secure payments</li>
<li>Restricted access to authorized personnel only</li>
</ul>

<h2>5. Your Rights</h2>
<ul>
<li>Update or correct your data anytime</li>
<li>Request account deletion from Profile, or by emailing support@clinik.co.in</li>
<li>Control notifications and location sharing in settings</li>
</ul>`,
    configType: 'string',
    description: 'Privacy Policy content',
    category: 'policy',
    isEditable: true
  },
  {
    configKey: 'policy_cancellation_refund',
    configValue: `<h1>Cancellation & Refund Policy</h1>
<p>We provide flexibility for both patients and hospitals to cancel bookings with transparent refund processes.</p>

<h2>Cancellation Policy</h2>

<h3>1. Patient-Initiated Cancellation</h3>
<ul>
<li>You may cancel a token anytime <strong>before consultation begins</strong></li>
<li>Rescheduling may be allowed if the hospital permits</li>
</ul>

<h3>2. Late Arrival</h3>
<p>If you are late, hospital staff may place your token on <strong>"Hold"</strong> or mark it <strong>"Cancelled"</strong>.</p>

<h3>3. Doctor/Hospital Cancellation</h3>
<ul>
<li>If a doctor cannot attend, the hospital may cancel the schedule</li>
<li>All affected patients will be notified immediately</li>
</ul>

<h2>Refund Policy</h2>

<h3>When Refunds Are Eligible</h3>
<ul>
<li>Doctor cancels the schedule</li>
<li>Hospital cancels your booking due to unforeseen reasons</li>
<li>You cancel your token within the hospital's allowed cancellation window</li>
</ul>

<h3>When Refunds Are Not Provided</h3>
<ul>
<li>Patient does not show up</li>
<li>Cancellation occurs after consultation has started</li>
<li>Cancellation is marked ineligible by hospital rules</li>
</ul>

<h3>Refund Timeline</h3>
<p>Eligible refunds are processed within 5-7 business days back to your original payment method.</p>`,
    configType: 'string',
    description: 'Cancellation and Refund Policy content',
    category: 'policy',
    isEditable: true
  },
  {
    configKey: 'policy_contactUs',
    configValue: `<h1>Contact Us</h1>
<p>If you need help with bookings, refunds, or account access, reach us using the details below.</p>

<h2>Email</h2>
<p><a href="mailto:support@clinicflow.com">support@clinicflow.com</a></p>

<h2>Phone</h2>
<p>+91-XXXX-XXXXXX (Mon–Fri, 9:00 AM – 6:00 PM)</p>

<h2>Address</h2>
<p>India</p>

<h2>Support Hours</h2>
<p>24/7 online ticket support via the app</p>`,
    configType: 'string',
    description: 'Contact Us page content',
    category: 'policy',
    isEditable: true
  },
  {
    configKey: 'policy_additional',
    configValue: `<h1>Additional Policies</h1>
<p>Comprehensive policies governing various aspects of ClinicFlow services.</p>

<h2>Data Security Policy</h2>
<ul>
<li><strong>Encryption Standards:</strong> All patient data is encrypted using industry-standard AES-256 encryption</li>
<li><strong>Access Controls:</strong> Multi-factor authentication and role-based access controls</li>
<li><strong>Data Backup:</strong> Regular automated backups ensure data integrity</li>
<li><strong>Security Monitoring:</strong> 24/7 monitoring systems detect and prevent unauthorized access</li>
</ul>

<h2>Non-Discrimination Policy</h2>
<ul>
<li><strong>Equal Access:</strong> We provide equal access to all users regardless of race, gender, religion, age, disability, or sexual orientation</li>
<li><strong>Healthcare Providers:</strong> We work only with licensed healthcare providers who maintain non-discriminatory practices</li>
<li><strong>Platform Usage:</strong> All users are expected to treat others with respect and dignity</li>
</ul>

<h2>Service Availability Policy</h2>
<ul>
<li><strong>Platform Availability:</strong> ClinicFlow aims to maintain 99.5% uptime</li>
<li><strong>Emergency Maintenance:</strong> Critical updates may be performed with minimal advance notice</li>
<li><strong>Service Interruptions:</strong> Users will be notified of planned maintenance at least 24 hours in advance</li>
</ul>

<h2>Payment and Billing Policy</h2>
<ul>
<li><strong>Platform Fees:</strong> Small platform fee for booking and queue management services</li>
<li><strong>Payment Methods:</strong> We accept major credit cards, debit cards, and digital wallets</li>
<li><strong>Billing Disputes:</strong> Disputes can be raised within 60 days of transaction</li>
<li><strong>Refund Processing:</strong> Eligible refunds are processed within 5-7 business days</li>
</ul>

<h2>Liability Limitations</h2>
<ul>
<li><strong>Platform Liability:</strong> Limited to the platform fees paid for the specific service</li>
<li><strong>Healthcare Provider Responsibility:</strong> Providers are solely responsible for medical consultations and outcomes</li>
<li><strong>Technical Issues:</strong> Not liable for losses due to technical failures beyond our control</li>
</ul>

<h2>Intellectual Property Policy</h2>
<ul>
<li><strong>ClinicFlow IP:</strong> All content, software, designs, and trademarks are owned by ClinicFlow</li>
<li><strong>User Content:</strong> Users retain ownership but grant permission to use for providing services</li>
<li><strong>Copyright Protection:</strong> We respect intellectual property rights and respond to valid DMCA notices</li>
</ul>`,
    configType: 'string',
    description: 'Additional Policies content',
    category: 'policy',
    isEditable: true
  },
  {
    configKey: 'policy_about_us',
    configValue: `<h1>About ClinicFlow</h1>
<p>Transforming Healthcare Experience</p>

<h2>Who We Are</h2>
<p>ClinicFlow is a digital healthcare platform that revolutionizes how patients interact with healthcare providers by eliminating long waiting times and providing real-time updates about appointments and queue status.</p>

<h2>Our Mission</h2>
<p>To make healthcare more accessible and efficient by providing patients with real-time information about their appointments, reducing wait times, and improving the overall healthcare experience through innovative technology solutions.</p>

<h2>Our Vision</h2>
<p>To become the leading digital healthcare platform that connects patients and healthcare providers seamlessly, creating a world where healthcare access is transparent, efficient, and patient-centered.</p>

<h2>What We Do</h2>
<p>ClinicFlow bridges the gap between patients and healthcare providers through our comprehensive digital platform:</p>
<ul>
<li>Smart Queue Management</li>
<li>Real-time Notifications</li>
<li>Multi-platform Access</li>
<li>Secure Data Handling</li>
<li>Hospital Integration</li>
<li>24/7 Support</li>
</ul>

<h2>Our Values</h2>
<ul>
<li><strong>Patient First:</strong> Every decision puts patient convenience and health outcomes at the center</li>
<li><strong>Trust & Security:</strong> We maintain the highest standards of data privacy and security</li>
<li><strong>Time Respect:</strong> We value everyone's time and work to eliminate unnecessary delays</li>
<li><strong>Innovation:</strong> We continuously innovate to make healthcare more accessible and efficient</li>
</ul>

<h2>Key Services</h2>
<ul>
<li><strong>Token Booking System:</strong> Book consultation tokens digitally and get real-time updates</li>
<li><strong>Queue Management:</strong> Advanced system that provides accurate waiting time estimates</li>
<li><strong>Smart Notifications:</strong> Instant notifications about doctor arrivals, delays, and your turn</li>
<li><strong>Hospital Integration:</strong> Seamless integration ensuring accurate information flow</li>
</ul>`,
    configType: 'string',
    description: 'About Us page content',
    category: 'policy',
    isEditable: true
  },
  {
    configKey: 'help_faqs',
    configValue: `<h1>Frequently Asked Questions</h1>

<h2>General</h2>

<h3>What is ClinicFlow?</h3>
<p>ClinicFlow is a digital platform that helps patients book consultation tokens at hospitals/clinics, track queues in real time, and get updates about schedules. <strong>Important:</strong> ClinicFlow is not a hospital or healthcare provider and does not charge or collect consultation fees.</p>

<h3>Do I need to pay to use ClinicFlow?</h3>
<p>Yes. ClinicFlow charges a small platform fee when you book a token. This fee covers booking, notifications, and real-time tracking services. The consultation fee must be paid directly at the hospital/clinic.</p>

<h3>Can I use ClinicFlow without creating an account?</h3>
<p>No. Registration is required to book tokens, receive updates, and track your appointment.</p>

<h2>Booking & Tokens</h2>

<h3>How do I book a token?</h3>
<ol>
<li>Log in to ClinicFlow</li>
<li>Search for your hospital/doctor</li>
<li>Select an available schedule</li>
<li>Pay the ClinicFlow platform fee</li>
<li>You'll receive your token number instantly</li>
</ol>

<h3>Do I need to pay the consultation fee in the app?</h3>
<p>No. Consultation fees are collected directly by the hospital/clinic at the time of your visit. ClinicFlow does not handle or process consultation fee payments.</p>

<h3>Can I choose a specific consultation time?</h3>
<p>No. Tokens are sequential. You will get an estimated consultation time based on doctor arrival and average consultation duration.</p>

<h3>What if I am late for my token?</h3>
<p>If you are late, hospital staff may place your token on "Hold" and allow you later (depending on hospital policy), or your token may be cancelled.</p>

<h3>What if the doctor is late?</h3>
<p>You'll get notified when the doctor arrives, and your estimated consultation time will be adjusted.</p>

<h2>Cancellations</h2>

<h3>How can I cancel my token?</h3>
<p>Go to My Bookings > Select Token > Cancel. Tokens must be cancelled before consultation starts.</p>

<h3>Can I reschedule my token?</h3>
<p>Rescheduling depends on the hospital's policy. Some hospitals allow it, others require a new booking.</p>

<h3>What if the doctor cancels the schedule?</h3>
<p>You'll be notified instantly. Your ClinicFlow platform fee will be refunded automatically. Any consultation fee paid at the hospital must be claimed directly from the hospital.</p>

<h2>Payments & Refunds</h2>

<h3>What payments are made in ClinicFlow?</h3>
<p>You only pay the ClinicFlow platform fee through the app. The consultation fee is paid separately at the hospital.</p>

<h3>When will I get a refund?</h3>
<p>Refunds apply only to the ClinicFlow platform fee. You are eligible if:</p>
<ul>
<li>The doctor/hospital cancels the schedule</li>
<li>You cancel your token within the hospital's allowed cancellation window</li>
</ul>

<h3>When am I not eligible for a refund?</h3>
<ul>
<li>If you do not show up</li>
<li>If you cancel after the consultation has started</li>
<li>If hospital rules mark your cancellation as ineligible</li>
</ul>

<h3>How long does it take to get my refund?</h3>
<p>Eligible ClinicFlow platform fee refunds will be processed within 5–7 business days back to your original payment method.</p>

<h2>Notifications & Updates</h2>

<h3>What notifications will I receive?</h3>
<p>You'll get real-time notifications for:</p>
<ul>
<li>Token booking start</li>
<li>Doctor arrival</li>
<li>Token progress (start, hold, pause, cancel)</li>
<li>Schedule changes</li>
<li>Travel-time reminders (if location enabled)</li>
</ul>

<h3>Can I turn off notifications?</h3>
<p>Yes. You can adjust notification preferences in the app, but we recommend keeping them enabled to avoid missing critical updates.</p>

<h2>Privacy & Security</h2>

<h3>Is my data safe?</h3>
<p>Yes. ClinicFlow uses encryption and secure servers. Your data is shared only with the hospital/doctor you book with.</p>

<h3>Can I delete my account?</h3>
<p>Yes. Open Profile and tap Delete Account to start a request, or email support@clinik.co.in from your registered email address. We verify and process requests within 30 days. Appointment and payment records are retained as required by Indian tax law.</p>

<h3>Does ClinicFlow track my location?</h3>
<p>Only if you enable location services. Location is used for travel-time reminders to help you arrive on time.</p>`,
    configType: 'string',
    description: 'FAQs content',
    category: 'help',
    isEditable: true
  }
];

async function seedPolicies() {
  try {
    console.log('Starting policy seeding...');

    for (const policy of policies) {
      // Check if policy already exists
      const existing = await db
        .select()
        .from(adminConfigurations)
        .where(eq(adminConfigurations.configKey, policy.configKey))
        .limit(1);

      if (existing.length > 0) {
        console.log(`Policy ${policy.configKey} already exists, skipping...`);
        continue;
      }

      // Insert new policy
      await db.insert(adminConfigurations).values({
        ...policy,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      console.log(`✓ Seeded ${policy.configKey}`);
    }

    console.log('\n✅ Policy seeding completed successfully!');
  } catch (error) {
    console.error('❌ Error seeding policies:', error);
    throw error;
  }
}

// Run if called directly
seedPolicies()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

export { seedPolicies };
