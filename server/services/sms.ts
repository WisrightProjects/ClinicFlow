// SMS service — My Dreams Technology provider with mock fallback for development
import { randomInt } from 'crypto';

interface SMSProvider {
  sendSMS(to: string, message: string, templateId?: string): Promise<void>;
}

class MockSMSProvider implements SMSProvider {
  async sendSMS(to: string, message: string, templateId?: string): Promise<void> {
    console.log(`[MOCK SMS] Sending to ${to} (template: ${templateId ?? 'none'}): ${message}`);
    const otpMatch = message.match(/\b\d{6}\b/);
    if (otpMatch) {
      console.log(`[MOCK SMS] OTP Code: ${otpMatch[0]}`);
    }
  }
}

class MyDreamsTechSMSProvider implements SMSProvider {
  private readonly apiKey: string;
  private readonly senderId: string;
  private readonly endpoint = 'http://app.mydreamstechnology.in/vb/apikey.php';

  constructor() {
    this.apiKey = process.env.MDT_SMS_API_KEY || 'BLZqVzWRDT7oNYS0';
    this.senderId = process.env.MDT_SMS_SENDER_ID || 'CLINEK';
  }

  async sendSMS(to: string, message: string, templateId?: string): Promise<void> {
    const params = new URLSearchParams({
      apikey: this.apiKey,
      senderid: this.senderId,
      number: to,
      message,
      ...(templateId && { templateid: templateId }),
    });

    const url = `${this.endpoint}?${params.toString()}`;
    console.log(`[MDT SMS] Calling: senderid=${this.senderId} apikey=${this.apiKey.slice(0, 4)}**** templateid=${templateId}`);
    const response = await fetch(url);
    const text = await response.text();

    let success = false;
    try {
      const json = JSON.parse(text);
      success = json?.status?.toLowerCase() === 'success';
    } catch {
      success = text.trim().toUpperCase() === 'SENT';
    }

    if (!success) {
      console.error(`[MDT SMS] Failed for ${to}: ${text}`);
      throw new Error(`SMS delivery failed: ${text}`);
    }
    console.log(`[MDT SMS] Sent to ${to}`);
  }
}

class SMSService {
  private provider: SMSProvider;
  private readonly loginOtpTemplateId: string;
  private readonly resetPasswordOtpTemplateId: string;

  constructor() {
    this.loginOtpTemplateId = process.env.MDT_SMS_LOGIN_TEMPLATE_ID || '1707177977132634973';
    this.resetPasswordOtpTemplateId = process.env.MDT_SMS_RESET_TEMPLATE_ID || '1707177977143946326';

    if (process.env.MDT_SMS_MOCK === 'true') {
      this.provider = new MockSMSProvider();
      console.log('SMS Service: Using mock provider');
    } else {
      this.provider = new MyDreamsTechSMSProvider();
      console.log('SMS Service: Using My Dreams Technology provider');
    }
  }

  generateOTP(): string {
    return randomInt(100000, 999999).toString();
  }

  async sendOTP(phoneNumber: string, otp: string): Promise<void> {
    // Must match registered DLT template exactly (template ID: 1707177977132634973)
    const message = `${otp} is your OTP to login. Valid for 10 minutes. Don't share this OTP with anyone. More details visit https://clinik.co.in/ - CLINEK`;
    await this.provider.sendSMS(phoneNumber, message, this.loginOtpTemplateId);
  }

  async sendPasswordResetOTP(phoneNumber: string, otp: string): Promise<void> {
    // Must match registered DLT template exactly (template ID: 1707177977143946326)
    const message = `${otp} is OTP to Reset your password. Valid for 10 minutes. Don't share this OTP with anyone. More details visit https://clinik.co.in/ - CLINEK`;
    await this.provider.sendSMS(phoneNumber, message, this.resetPasswordOtpTemplateId);
  }

  async sendAppointmentReminder(phoneNumber: string, doctorName: string, appointmentTime: string): Promise<void> {
    const message = `Reminder: You have an appointment with Dr. ${doctorName} at ${appointmentTime}. Please arrive 10 minutes early.`;
    await this.provider.sendSMS(phoneNumber, message);
  }

  async sendAppointmentConfirmation(phoneNumber: string, doctorName: string, appointmentTime: string, tokenNumber: number): Promise<void> {
    const message = `Your appointment with Dr. ${doctorName} is confirmed for ${appointmentTime}. Your token number is ${tokenNumber}.`;
    await this.provider.sendSMS(phoneNumber, message);
  }

  async sendDoctorArrivalNotification(phoneNumber: string, doctorName: string): Promise<void> {
    const message = `Dr. ${doctorName} has arrived and consultations have started. Please be ready when your token is called.`;
    await this.provider.sendSMS(phoneNumber, message);
  }

  async sendTokenProgressNotification(phoneNumber: string, currentToken: number, yourToken: number): Promise<void> {
    const tokensAway = yourToken - currentToken;
    const message = `Current token: ${currentToken}. Your token: ${yourToken}. You are ${tokensAway} tokens away. Please be ready.`;
    await this.provider.sendSMS(phoneNumber, message);
  }
}

export const smsService = new SMSService();
