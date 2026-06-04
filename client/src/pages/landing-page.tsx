import React from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { NavHeader } from "@/components/nav-header";
import { Card, CardContent } from "@/components/ui/card";
import { Check, MapPin, Calendar, Shield, Smartphone, ArrowRight, Bell, Wallet } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top nav stays consistent with app theme */}
      <NavHeader />

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-primary/5 to-transparent">
        {/* subtle radial accent */}
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          <div className="absolute -top-32 -right-24 h-80 w-80 rounded-full bg-primary/15 blur-3xl" />
          <div className="absolute -bottom-28 -left-28 h-80 w-80 rounded-full bg-primary/10 blur-3xl" />
        </div>

        <div className="mx-auto w-full max-w-6xl px-4 py-10 md:py-16 grid gap-12 md:grid-cols-12 items-center">
          <div className="md:col-span-7">
            <span className="inline-flex items-center rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground">
              Trusted clinic workflow platform
            </span>
            <h1 className="mt-4 text-3xl md:text-5xl font-bold leading-tight tracking-tight">
              One platform for <span className="text-primary">clinics</span>, doctors and patients
            </h1>
            <p className="mt-4 text-muted-foreground text-base md:text-lg max-w-2xl">
              Book appointments, manage schedules, track tokens and get real‑time updates — all in one place.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild size="lg" className="rounded-full">
                <Link href="/home">
                  <Calendar className="mr-2" /> Explore Clinics & Doctors
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="rounded-full">
                <Link href="/map">
                  <MapPin className="mr-2" /> Find Near Me
                </Link>
              </Button>
            </div>


            {/* Quick auth entry points */}
            <div className="mt-4 flex flex-wrap gap-3">
              <Button asChild size="lg" className="rounded-full">
                <Link href="/patient-login">Patient Login</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="rounded-full border-primary text-primary hover:bg-primary/10">
                <Link href="/patient-register">Create Patient Account</Link>
              </Button>
            </div>
          </div>

          <div className="md:col-span-5 order-first md:order-last">
            <div className="rounded-xl border bg-card/80 backdrop-blur shadow-sm">
              <div className="p-6 grid gap-4">
                <FeatureRow icon={<Smartphone className="text-primary" />} title="Fast mobile OTP/MPIN login" />
                <FeatureRow icon={<Calendar className="text-primary" />} title="Schedule‑based booking with live tokening" />
                <FeatureRow icon={<Bell className="text-primary" />} title="Notifications for token status & schedule updates" />
                <FeatureRow icon={<Shield className="text-primary" />} title="Secure sessions and audit of login attempts" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Feature highlights */}
      <section className="mx-auto w-full max-w-6xl px-4 py-10">
        <div className="grid gap-6 md:grid-cols-4">
          <Card className="bg-card">
            <CardContent className="p-6">
              <MapPin className="h-6 w-6 text-primary" />
              <h3 className="mt-3 font-semibold">Nearby discovery</h3>
              <p className="text-sm text-muted-foreground mt-1">Find clinics around you with precise distance and route context.</p>
            </CardContent>
          </Card>
          <Card className="bg-card">
            <CardContent className="p-6">
              <Calendar className="h-6 w-6 text-primary" />
              <h3 className="mt-3 font-semibold">Live schedules</h3>
              <p className="text-sm text-muted-foreground mt-1">See visible sessions and availability before you book.</p>
            </CardContent>
          </Card>
          <Card className="bg-card">
            <CardContent className="p-6">
              <Bell className="h-6 w-6 text-primary" />
              <h3 className="mt-3 font-semibold">Real‑time updates</h3>
              <p className="text-sm text-muted-foreground mt-1">Token progress, ETA, and schedule changes straight to your phone.</p>
            </CardContent>
          </Card>
          <Card className="bg-card">
            <CardContent className="p-6">
              <Wallet className="h-6 w-6 text-primary" />
              <h3 className="mt-3 font-semibold">Wallet & refunds</h3>
              <p className="text-sm text-muted-foreground mt-1">Simple fee, transparent ledger, automatic refunds on cancellations.</p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Patient story (long‑form) */}
      <section className="mx-auto w-full max-w-6xl px-4 py-4 grid gap-8 md:grid-cols-2">
        <Card className="bg-muted/20">
          <CardContent className="p-8">
            <h2 className="text-2xl font-semibold">Why choose Clinik</h2>
            <div className="prose prose-slate max-w-none mt-3 text-sm md:text-base">
              <p>
                Clinik simplifies hospital visits. Search doctors or hospitals, view real‑time schedules, and book in seconds.
                We generate your token instantly and estimate when you will be seen. While you travel, token progress and ETA keep
                updating so you can arrive just in time rather than wait in long queues.
              </p>
              <p>
                Notifications alert you when the doctor arrives, when your token starts, or if a schedule changes. You can mark
                favorite doctors/schedules to get back quickly. Payments use a small in‑app platform fee; if a schedule is cancelled
                or a session ends early, refunds are credited automatically to your wallet with a clear ledger.
              </p>
              <p>
                Your data is protected. We use secure sessions, OTP/MPIN login, and never sell personal data. Only the clinic you
                book with receives the minimum details needed to serve you.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardContent className="p-8">
            <h2 className="text-2xl font-semibold">How Clinik works</h2>
            <div className="prose prose-slate max-w-none mt-3 text-sm md:text-base">
              <p>
                1) Find a nearby clinic or search by doctor/specialty. 2) Pick a visible schedule that suits your time. 3) Confirm
                booking and receive a token number with an estimated start time. 4) Track live progress on your phone, get notified
                when it is your turn, and walk straight in. Your bookings and wallet history stay available in the dashboard.
              </p>
              <p>
                Prefer planning ahead? Save favorite schedules and we will highlight them when they become available again. Need help?
                Visit FAQs or contact us from the footer.
              </p>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Bottom CTA */}
      <section className="mx-auto w-full max-w-6xl px-4 pb-10">
        <div className="rounded-2xl bg-primary text-primary-foreground p-6 md:p-8 flex flex-col md:flex-row items-center justify-between">
          <div className="text-center md:text-left">
            <h3 className="text-xl md:text-2xl font-semibold">Ready to skip the queue?</h3>
            <p className="opacity-90 text-sm md:text-base">Book now and get your token with a live ETA in seconds.</p>
          </div>
          <div className="mt-4 md:mt-0 flex gap-3">
            <Button asChild size="lg" variant="secondary" className="rounded-full">
              <Link href="/home">Start booking</Link>
            </Button>
            <Button asChild size="lg" className="rounded-full">
              <Link href="/map">Find Near Me</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Compliance & assurances */}
      <section className="mx-auto w-full max-w-6xl px-4 pb-6">
        <div className="grid gap-6 md:grid-cols-3">
          <Card className="bg-muted/10">
            <CardContent className="p-6">
              <h3 className="text-lg font-semibold">Security & Privacy</h3>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground list-disc ml-5">
                <li>Encrypted data in transit and at rest</li>
                <li>OTP/MPIN authentication with session security</li>
                <li>Least‑privilege access; audit logs for login attempts</li>
                <li>No sale of personal data; data shared only for care delivery</li>
              </ul>
            </CardContent>
          </Card>

          <Card className="bg-muted/10">
            <CardContent className="p-6">
              <h3 className="text-lg font-semibold">Data Handling</h3>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground list-disc ml-5">
                <li>Purpose limitation and minimal data collection</li>
                <li>Retention aligned to legal requirements</li>
                <li>User rights: access, correction, deletion</li>
                <li>Breach response & notification procedures</li>
              </ul>
            </CardContent>
          </Card>

          <Card className="bg-muted/10">
            <CardContent className="p-6">
              <h3 className="text-lg font-semibold">Payments & Refunds</h3>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground list-disc ml-5">
                <li>Platform fee only; no card data stored</li>
                <li>Wallet ledger for transparency</li>
                <li>Automatic refunds on schedule cancellations</li>
                <li>Clear rules for eligibility and timelines</li>
              </ul>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 md:grid-cols-3 mt-6">
          <Card className="bg-muted/10">
            <CardContent className="p-6">
              <h3 className="text-lg font-semibold">Clinical Disclaimer</h3>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground list-disc ml-5">
                <li>Clinik is not a medical provider</li>
                <li>Hospitals/doctors are responsible for care</li>
                <li>App provides booking, queueing and notifications</li>
              </ul>
            </CardContent>
          </Card>

          <Card className="bg-muted/10">
            <CardContent className="p-6">
              <h3 className="text-lg font-semibold">Availability & Support</h3>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground list-disc ml-5">
                <li>Uptime target 99.5% with monitored services</li>
                <li>Incident response and status updates</li>
                <li>Support: 24/7 ticketing; phone weekdays</li>
              </ul>
            </CardContent>
          </Card>

          <Card className="bg-muted/10">
            <CardContent className="p-6">
              <h3 className="text-lg font-semibold">Regulatory</h3>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground list-disc ml-5">
                <li>Safeguards aligned with DPDP/IT Act</li>
                <li>HIPAA‑like administrative & technical controls</li>
                <li>Regular reviews of policies and access</li>
              </ul>
            </CardContent>
          </Card>
        </div>

        <div className="text-xs text-muted-foreground mt-4">
          See full details in <Link href="/policies/privacy-policy" className="text-primary hover:underline">Privacy Policy</Link>, 
          <Link href="/policies/terms-conditions" className="text-primary hover:underline ml-1">Terms</Link>, and 
          <Link href="/policies/additional-policies" className="text-primary hover:underline ml-1">Disclaimer</Link>.
        </div>
      </section>

      {/* Policies and contact */}
      <section className="border-t">
        <div className="container mx-auto px-4 py-10 grid gap-3 md:grid-cols-2">
          <div className="flex flex-wrap gap-3 text-sm">
            <Link className="text-muted-foreground hover:text-foreground" href="/policies/about-us">About Us</Link>
            <span className="text-muted-foreground">•</span>
            <Link className="text-muted-foreground hover:text-foreground" href="/policies/terms-conditions">Terms & Conditions</Link>
            <span className="text-muted-foreground">•</span>
            <Link className="text-muted-foreground hover:text-foreground" href="/policies/privacy-policy">Privacy Policy</Link>
            <span className="text-muted-foreground">•</span>
            <Link className="text-muted-foreground hover:text-foreground" href="/policies/cancellation-refund">Cancellation & Refund</Link>
            <span className="text-muted-foreground">•</span>
            <Link className="text-muted-foreground hover:text-foreground" href="/policies/additional-policies">Disclaimer Policy</Link>
            <span className="text-muted-foreground">•</span>
            <Link className="text-muted-foreground hover:text-foreground" href="/help/faqs">FAQs</Link>
          </div>
          <div className="text-sm md:text-right text-muted-foreground">
            Need help? <Link href="/contact-us" className="text-primary hover:underline">Contact us</Link>
          </div>
        </div>
        <div className="container mx-auto px-4 pb-8 mt-2 text-xs text-muted-foreground flex items-center justify-between">
          <span>© 2025 Mano Tech Services</span>
          <span className="hidden md:inline">All rights reserved.</span>
        </div>
      </section>
    </div>
  );
}

function FeatureRow({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-1">{icon}</div>
      <div className="flex-1">
        <p className="font-medium flex items-center gap-2">
          <Check className="h-4 w-4 text-primary" /> {title}
        </p>
      </div>
    </div>
  );
}

function InfoCard({ title, points, cta }: { title: string; points: string[]; cta?: { label: string; href: string } }) {
  return (
    <Card className="bg-muted/30">
      <CardContent className="p-6">
        <h3 className="text-xl font-semibold">{title}</h3>
        <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
          {points.map((p, i) => (
            <li key={i} className="flex items-start gap-2">
              <Check className="h-4 w-4 text-primary mt-0.5" />
              <span>{p}</span>
            </li>
          ))}
        </ul>
        {cta && (
          <div className="mt-4">
            <Button asChild variant="secondary">
              <Link href={cta.href}>
                {cta.label} <ArrowRight className="ml-2" />
              </Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
