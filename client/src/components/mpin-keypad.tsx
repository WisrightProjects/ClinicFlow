// MPIN keypad: masked 4-digit display with an on-screen number pad for entry
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface MpinKeypadProps {
  value: string;
  placeholder: string;
  showToggle?: boolean;
  reveal?: boolean;
  onToggleReveal?: () => void;
  onDigit: (digit: string) => void;
  onClear: () => void;
  onBackspace: () => void;
}

export function MpinKeypad({
  value,
  placeholder,
  showToggle = false,
  reveal = false,
  onToggleReveal,
  onDigit,
  onClear,
  onBackspace,
}: MpinKeypadProps) {
  const isFull = value.length >= 4;

  return (
    <div className="space-y-3">
      <div className="relative">
        <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500" />
        <Input
          value={value}
          type={reveal ? "text" : "password"}
          placeholder={placeholder}
          className="pl-10 text-center text-2xl tracking-[0.5em] font-bold placeholder:text-sm placeholder:tracking-normal placeholder:font-normal"
          maxLength={4}
          readOnly
        />
        {showToggle && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="absolute right-2 top-1/2 transform -translate-y-1/2"
            onClick={onToggleReveal}
          >
            {reveal ? "Hide" : "Show"}
          </Button>
        )}
      </div>

      {/* Number pad */}
      <div className="grid grid-cols-3 gap-2">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
          <Button
            key={digit}
            type="button"
            variant="outline"
            className="h-12 text-lg font-semibold"
            onClick={() => onDigit(digit.toString())}
            disabled={isFull}
          >
            {digit}
          </Button>
        ))}
        <Button
          type="button"
          variant="outline"
          className="h-12 text-sm"
          onClick={onClear}
        >
          Clear
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-12 text-lg font-semibold"
          onClick={() => onDigit("0")}
          disabled={isFull}
        >
          0
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-12 text-sm"
          onClick={onBackspace}
        >
          ←
        </Button>
      </div>
    </div>
  );
}
