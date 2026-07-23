import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Wallet, 
  ArrowUpCircle, 
  ArrowDownCircle,
  RefreshCw,
  Calendar,
  TrendingUp,
  TrendingDown,
  Activity
} from 'lucide-react';
import { format } from 'date-fns';

interface WalletSummary {
  wallet: {
    id: number;
    balance: string;
    totalEarned: string;
    totalSpent: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
  };
  recentTransactions: any[];
  stats: {
    totalTransactions: number;
    totalRefunds: number;
    totalSpent: number;
  };
}

export function CompactWallet() {
  const { data: walletSummary, isLoading } = useQuery<WalletSummary>({
    queryKey: ['/api/wallet/summary'],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const balance = walletSummary ? parseFloat(walletSummary.wallet.balance) : 0;

  const getTransactionIcon = (type: string) => {
    const isCredit = [
      'refund_schedule_cancel',
      'refund_doctor_absent', 
      'partial_refund',
      'admin_credit',
      'wallet_topup'
    ].includes(type);
    
    return isCredit ? (
      <ArrowUpCircle className="h-3 w-3 text-green-600" />
    ) : (
      <ArrowDownCircle className="h-3 w-3 text-red-600" />
    );
  };

  const getTransactionTypeLabel = (type: string) => {
    const labels: { [key: string]: string } = {
      'appointment_payment': 'Appointment Payment',
      'refund_schedule_cancel': 'Schedule Cancelled - Refund',
      'refund_doctor_absent': 'Doctor Absent - Refund',
      'partial_refund': 'Partial Session - Refund',
      'admin_credit': 'Admin Credit',
      'admin_debit': 'Admin Debit',
      'wallet_topup': 'Wallet Top-up',
      'withdrawal': 'Withdrawal'
    };
    return labels[type] || type;
  };

  const getTransactionColor = (type: string) => {
    const isCredit = [
      'refund_schedule_cancel',
      'refund_doctor_absent', 
      'partial_refund',
      'admin_credit',
      'wallet_topup'
    ].includes(type);
    
    return isCredit ? 'text-green-600' : 'text-red-600';
  };

  if (isLoading) {
    return (
      <Button variant="ghost" size="sm" disabled>
        <Wallet className="h-4 w-4 mr-2" />
        <Skeleton className="h-4 w-12" />
      </Button>
    );
  }

  return (
    <Dialog>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-2">
            <Wallet className="h-4 w-4" />
            <span className="hidden sm:inline">₹{balance.toFixed(2)}</span>
            <span className="sm:hidden">₹{balance.toFixed(0)}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80" align="end">
          <div className="space-y-4">
            {/* Balance Header */}
            <div className="text-center">
              <p className="text-2xl font-bold text-green-600">₹{balance.toFixed(2)}</p>
              <p className="text-sm text-muted-foreground">Available Balance</p>
              {walletSummary?.wallet.isActive ? (
                <Badge variant="default" className="bg-green-500 mt-1">Active</Badge>
              ) : (
                <Badge variant="secondary" className="mt-1">Inactive</Badge>
              )}
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-2 gap-3">
              <div className="text-center p-2 bg-green-50 dark:bg-green-950 rounded-lg">
                <TrendingUp className="h-4 w-4 text-green-600 mx-auto mb-1" />
                <p className="text-xs text-green-700 dark:text-green-400">Earned</p>
                <p className="text-sm font-semibold text-green-800 dark:text-green-300">
                  ₹{parseFloat(walletSummary?.wallet.totalEarned || '0').toFixed(0)}
                </p>
              </div>
              <div className="text-center p-2 bg-blue-50 dark:bg-blue-950 rounded-lg">
                <TrendingDown className="h-4 w-4 text-blue-600 mx-auto mb-1" />
                <p className="text-xs text-blue-700 dark:text-blue-400">Spent</p>
                <p className="text-sm font-semibold text-blue-800 dark:text-blue-300">
                  ₹{parseFloat(walletSummary?.wallet.totalSpent || '0').toFixed(0)}
                </p>
              </div>
            </div>

            {/* Recent Transactions */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium">Recent Transactions</p>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    View All
                  </Button>
                </DialogTrigger>
              </div>
              
              {walletSummary?.recentTransactions.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">
                  No transactions yet
                </p>
              ) : (
                <div className="space-y-2 max-h-32 overflow-y-auto">
                  {walletSummary?.recentTransactions.slice(0, 3).map((transaction) => {
                    // Math.abs guards legacy appointment_payment rows stored negative
                    const amount = Math.abs(parseFloat(transaction.amount));
                    const isCredit = [
                      'refund_schedule_cancel',
                      'refund_doctor_absent', 
                      'partial_refund',
                      'admin_credit',
                      'wallet_topup'
                    ].includes(transaction.transactionType);
                    
                    return (
                      <div key={transaction.id} className="flex items-center justify-between p-2 bg-muted/50 rounded text-xs">
                        <div className="flex items-center gap-2">
                          {getTransactionIcon(transaction.transactionType)}
                          <div>
                            <p className="font-medium">
                              {getTransactionTypeLabel(transaction.transactionType)}
                            </p>
                            <p className="text-muted-foreground">
                              {format(new Date(transaction.createdAt), 'MMM dd, HH:mm')}
                            </p>
                          </div>
                        </div>
                        <p className={`font-semibold ${getTransactionColor(transaction.transactionType)}`}>
                          {isCredit ? '+' : '-'}₹{amount.toFixed(0)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Total Transactions */}
            <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
              <div className="flex items-center gap-1">
                <Activity className="h-3 w-3" />
                <span>Total Transactions</span>
              </div>
              <span>{walletSummary?.stats.totalTransactions || 0}</span>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            My Wallet - Complete View
          </DialogTitle>
          <DialogDescription>
            Complete wallet information and transaction history
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="text-center p-4 bg-green-50 dark:bg-green-950 rounded-lg">
            <p className="text-2xl font-bold text-green-600">₹{balance.toFixed(2)}</p>
            <p className="text-sm text-muted-foreground">Current Balance</p>
          </div>
          <div className="text-center p-4 bg-blue-50 dark:bg-blue-950 rounded-lg">
            <p className="text-lg font-bold text-blue-600">
              ₹{parseFloat(walletSummary?.wallet.totalEarned || '0').toFixed(2)}
            </p>
            <p className="text-sm text-muted-foreground">Total Earned</p>
          </div>
          <div className="text-center p-4 bg-orange-50 dark:bg-orange-950 rounded-lg">
            <p className="text-lg font-bold text-orange-600">
              ₹{parseFloat(walletSummary?.wallet.totalSpent || '0').toFixed(2)}
            </p>
            <p className="text-sm text-muted-foreground">Total Spent</p>
          </div>
        </div>

        <div>
          <h3 className="font-semibold mb-3">All Transactions</h3>
          <ScrollArea className="h-64 w-full border rounded-lg p-3">
            {walletSummary?.recentTransactions.length === 0 ? (
              <div className="text-center py-8">
                <Wallet className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground mb-2">No transactions yet</p>
                <p className="text-xs text-muted-foreground">
                  Your wallet transactions will appear here
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {walletSummary?.recentTransactions.map((transaction) => {
                  // Math.abs guards legacy appointment_payment rows stored negative
                  const amount = Math.abs(parseFloat(transaction.amount));
                  const isCredit = [
                    'refund_schedule_cancel',
                    'refund_doctor_absent', 
                    'partial_refund',
                    'admin_credit',
                    'wallet_topup'
                  ].includes(transaction.transactionType);
                  
                  return (
                    <div 
                      key={transaction.id} 
                      className="flex items-center justify-between p-3 border rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        {getTransactionIcon(transaction.transactionType)}
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-medium text-sm">
                              {getTransactionTypeLabel(transaction.transactionType)}
                            </p>
                            <Badge 
                              variant={transaction.status === 'completed' ? 'default' : 'secondary'}
                              className="text-xs"
                            >
                              {transaction.status}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mb-1">
                            {transaction.description}
                          </p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            {format(new Date(transaction.createdAt), 'MMM dd, yyyy HH:mm')}
                          </div>
                        </div>
                      </div>
                      
                      <div className="text-right">
                        <p className={`font-semibold ${getTransactionColor(transaction.transactionType)}`}>
                          {isCredit ? '+' : '-'}₹{amount.toFixed(2)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Balance: ₹{parseFloat(transaction.newBalance).toFixed(2)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}