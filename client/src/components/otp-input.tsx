// OTP digit-box input with auto-advance, backspace navigation, and paste support
import { useRef } from "react";

type OtpInputProps = {
  digits: string[];
  onChange: (digits: string[]) => void;
};

export function OtpInput({ digits, onChange }: OtpInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const count = digits.length;

  return (
    <div className="flex gap-2 justify-center">
      {digits.map((digit, idx) => (
        <input
          key={idx}
          ref={(el) => {
            refs.current[idx] = el;
          }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          autoComplete="off"
          value={digit}
          className="w-10 h-12 text-center border border-input rounded-md text-lg focus:outline-none focus:ring-2 focus:ring-ring"
          onChange={(e) => {
            const val = e.target.value.replace(/\D/g, "").slice(-1);
            const next = [...digits];
            next[idx] = val;
            onChange(next);
            if (val && idx < count - 1) refs.current[idx + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !digits[idx] && idx > 0) {
              refs.current[idx - 1]?.focus();
            }
          }}
          onPaste={(e) => {
            e.preventDefault();
            const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, count);
            const next = [...digits];
            pasted.split("").forEach((ch, i) => {
              if (i < count) next[i] = ch;
            });
            onChange(next);
            refs.current[Math.min(pasted.length, count - 1)]?.focus();
          }}
        />
      ))}
    </div>
  );
}
