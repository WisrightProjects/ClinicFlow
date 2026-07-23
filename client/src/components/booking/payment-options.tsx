// Fee breakdown + payment method picker shown before a booking is confirmed.

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Wallet, CreditCard } from "lucide-react";
import type { BookingFee, PaymentMethod } from "@shared/pricing";

interface PaymentOptionsProps {
  fee?: BookingFee;
  isLoadingFee: boolean;
  /** Current wallet balance in rupees. */
  walletBalance: number;
  /** False when the server has the online option switched off. */
  onlineEnabled: boolean;
  value: PaymentMethod;
  onChange: (method: PaymentMethod) => void;
}

export function PaymentOptions({
  fee,
  isLoadingFee,
  walletBalance,
  onlineEnabled,
  value,
  onChange,
}: PaymentOptionsProps) {
  const total = fee?.total ?? 0;
  const canUseWallet = !!fee && walletBalance >= total;

  return (
    <div className="space-y-4">
      {/* Fee breakdown */}
      <div className="rounded-lg border bg-muted/40 p-3 space-y-2">
        {isLoadingFee || !fee ? (
          <>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-5 w-32" />
          </>
        ) : (
          <>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Platform Fee</span>
              <span>₹{fee.platformFee.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">
                GST ({(fee.gstRate * 100).toFixed(0)}%)
              </span>
              <span>₹{fee.gstAmount.toFixed(2)}</span>
            </div>
            <Separator />
            <div className="flex justify-between font-semibold">
              <span>Total</span>
              <span>₹{fee.total.toFixed(2)}</span>
            </div>
            <p className="text-xs text-muted-foreground pt-1">
              This is a booking fee only. The doctor's consultation fee is paid at the clinic.
            </p>
          </>
        )}
      </div>

      {/* Payment method */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Pay using</Label>
        <RadioGroup
          value={value}
          onValueChange={(v) => onChange(v as PaymentMethod)}
          className="space-y-2"
        >
          <label
            htmlFor="pay-wallet"
            className={`flex items-center gap-3 rounded-lg border p-3 ${
              canUseWallet
                ? "cursor-pointer hover:bg-muted/50"
                : "opacity-60 cursor-not-allowed"
            } ${value === "wallet" && canUseWallet ? "border-primary ring-1 ring-primary" : ""}`}
          >
            <RadioGroupItem value="wallet" id="pay-wallet" disabled={!canUseWallet} />
            <Wallet className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Wallet</p>
              <p className="text-xs text-muted-foreground">
                {canUseWallet
                  ? `Balance ₹${walletBalance.toFixed(2)}`
                  : `Insufficient balance (₹${walletBalance.toFixed(2)})`}
              </p>
            </div>
          </label>

          <label
            htmlFor="pay-online"
            className={`flex items-center gap-3 rounded-lg border p-3 ${
              onlineEnabled ? "cursor-pointer hover:bg-muted/50" : "opacity-60 cursor-not-allowed"
            } ${value === "online" && onlineEnabled ? "border-primary ring-1 ring-primary" : ""}`}
          >
            <RadioGroupItem value="online" id="pay-online" disabled={!onlineEnabled} />
            <CreditCard className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Online</p>
              <p className="text-xs text-muted-foreground">
                {onlineEnabled ? "UPI / Card / Net Banking" : "Currently unavailable"}
              </p>
            </div>
          </label>
        </RadioGroup>

        {!canUseWallet && onlineEnabled && (
          <p className="text-xs text-muted-foreground">
            Your wallet balance is too low for this booking — pay online instead.
          </p>
        )}
      </div>
    </div>
  );
}
