import React from 'react';
import { WalletBalance } from '@/components/wallet/wallet-balance';
import { WalletTransactions } from '@/components/wallet/wallet-transactions';
import { NavHeader } from '@/components/nav-header';
import PatientFooter from '@/components/PatientFooter';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLocation } from 'wouter';
import { useToast } from '@/hooks/use-toast';

export default function PatientWallet() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // The server sends a patient here when their payment succeeded but the token could not
  // be created — the hold expired, or they already had an appointment. They are owed an
  // explanation, otherwise the balance simply changes with no stated reason.
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment') !== 'refunded') return;

    const reasons: Record<string, string> = {
      hold_expired: 'Your token was released before the payment finished, so the amount is back in your wallet.',
      duplicate_booking: 'You already had an appointment for that schedule, so the amount is back in your wallet.',
      booking_failed: 'We could not confirm your token, so the amount is back in your wallet.',
      already_settled: 'That payment was already processed — the amount is in your wallet.',
    };

    toast({
      title: 'Amount added to your wallet',
      description:
        reasons[params.get('reason') || ''] ??
        'Your booking could not be completed, so the amount is back in your wallet.',
    });

    // Clear only what we consumed, so any other query parameter survives.
    params.delete('payment');
    params.delete('reason');
    const query = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (query ? `?${query}` : ''));
  }, [toast]);

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <NavHeader />
      
      <div className="flex-1">
        <div className="container mx-auto py-8 px-4">
          {/* Header */}
          <div className="flex flex-wrap items-center gap-4 mb-6">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLocation('/')}
              className="gap-2 shrink-0"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Home
            </Button>
            <h1 className="text-2xl sm:text-3xl font-bold">My Wallet</h1>
          </div>

          {/* Wallet Content */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1">
              <WalletBalance />
            </div>
            <div className="lg:col-span-2">
              <WalletTransactions />
            </div>
          </div>
        </div>
      </div>
      
      <PatientFooter />
    </div>
  );
}