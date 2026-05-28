import React from 'react';
import { WalletBalance } from '@/components/wallet/wallet-balance';
import { WalletTransactions } from '@/components/wallet/wallet-transactions';
import { NavHeader } from '@/components/nav-header';
import PatientFooter from '@/components/PatientFooter';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLocation } from 'wouter';

export default function PatientWallet() {
  const [, setLocation] = useLocation();

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