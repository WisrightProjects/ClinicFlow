import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  History, 
  ArrowUpCircle, 
  ArrowDownCircle, 
  RefreshCw,
  Calendar,
  IndianRupee
} from 'lucide-react';
import { format } from 'date-fns';

interface WalletTransaction {
  id: number;
  transactionType: string;
  amount: string;
  previousBalance: string;
  newBalance: string;
  description: string;
  status: string;
  createdAt: string;
}

export function WalletTransactions() {
  const [page, setPage] = useState(0);
  const limit = 20;

  const { data: transactions, isLoading, error, refetch } = useQuery<WalletTransaction[]>({
    queryKey: ['/api/wallet/transactions', { limit, offset: page * limit }],
    refetchInterval: 60000, // Refresh every minute
  });

  const getTransactionIcon = (type: string) => {
    const isCredit = [
      'refund_schedule_cancel',
      'refund_doctor_absent', 
      'partial_refund',
      'admin_credit',
      'wallet_topup'
    ].includes(type);
    
    return isCredit ? (
      <ArrowUpCircle className="h-4 w-4 text-green-600" />
    ) : (
      <ArrowDownCircle className="h-4 w-4 text-red-600" />
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
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Transaction History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Array(5).fill(0).map((_, i) => (
              <div key={i} className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-4 w-4" />
                  <div>
                    <Skeleton className="h-4 w-32 mb-1" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </div>
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !transactions) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Transaction History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-muted-foreground mb-4">Unable to load transaction history</p>
            <Button onClick={() => refetch()} variant="outline" size="sm">
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <History className="h-5 w-5" />
          Transaction History
        </CardTitle>
        <Button onClick={() => refetch()} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        {transactions.length === 0 ? (
          <div className="text-center py-8">
            <IndianRupee className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground mb-2">No transactions yet</p>
            <p className="text-xs text-muted-foreground">
              Your wallet transactions will appear here
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {transactions.map((transaction) => {
              // Math.abs guards legacy rows: appointment payments used to be stored with a
              // negative amount, which combined with the sign prefix below to render
              // "-₹-21.00". New rows are positive; historical rows still need this.
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
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {getTransactionIcon(transaction.transactionType)}
                    <div className="flex-1">
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
            
            {/* Pagination */}
            <div className="flex justify-between items-center pt-4">
              <Button
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                variant="outline"
                size="sm"
              >
                Previous
              </Button>
              
              <span className="text-sm text-muted-foreground">
                Page {page + 1}
              </span>
              
              <Button
                onClick={() => setPage(page + 1)}
                disabled={transactions.length < limit}
                variant="outline"
                size="sm"
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}