import React from 'react';
import { Link } from 'wouter';
import { Phone, Mail, Shield, FileText, HelpCircle, Info, RefreshCw, Building2 } from 'lucide-react';

const PatientFooter: React.FC = () => {
  return (
    <footer className="bg-gray-900 text-white mt-auto">
      {/* Main Footer Content */}
      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          
          {/* Company Info */}
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <Building2 className="h-6 w-6 text-blue-400" />
              <h3 className="text-xl font-bold">Clinik</h3>
            </div>
            <p className="text-gray-300 text-sm">
              Your trusted healthcare companion. Book appointments, manage your health records, and connect with the best doctors in your area.
            </p>
            <div className="flex space-x-4">
              <div className="flex items-center space-x-2">
                <Phone className="h-4 w-4 text-blue-400" />
                <span className="text-sm">+91-95147 95157</span>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <Mail className="h-4 w-4 text-blue-400" />
              <span className="text-sm">support@clinik.co.in</span>
            </div>
          </div>

          {/* Quick Links */}
          <div className="space-y-4">
            <h4 className="text-lg font-semibold text-white">Quick Links</h4>
            <ul className="space-y-2">
              <li>
                <Link
                  href="/patient/dashboard"
                  className="text-gray-300 hover:text-blue-400 text-sm transition-colors duration-200"
                >
                  Find Doctors
                </Link>
              </li>
              <li>
                <Link
                  href="/appointments"
                  className="text-gray-300 hover:text-blue-400 text-sm transition-colors duration-200"
                >
                  My Appointments
                </Link>
              </li>
              <li>
                <Link
                  href="/profile"
                  className="text-gray-300 hover:text-blue-400 text-sm transition-colors duration-200"
                >
                  My Profile
                </Link>
              </li>
            </ul>
          </div>

          {/* Policies & Legal */}
          <div className="space-y-4">
            <h4 className="text-lg font-semibold text-white">Policies & Legal</h4>
            <ul className="space-y-2">
              <li>
                <Link
                  href="/policies/terms-conditions"
                  className="text-gray-300 hover:text-blue-400 text-sm transition-colors duration-200 flex items-center space-x-2"
                >
                  <FileText className="h-3 w-3" />
                  <span>Terms & Conditions</span>
                </Link>
              </li>
              <li>
                <Link
                  href="/policies/privacy-policy"
                  className="text-gray-300 hover:text-blue-400 text-sm transition-colors duration-200 flex items-center space-x-2"
                >
                  <Shield className="h-3 w-3" />
                  <span>Privacy Policy</span>
                </Link>
              </li>
              <li>
                <Link
                  href="/policies/cancellation-refund"
                  className="text-gray-300 hover:text-blue-400 text-sm transition-colors duration-200 flex items-center space-x-2"
                >
                  <RefreshCw className="h-3 w-3" />
                  <span>Cancellation & Refund</span>
                </Link>
              </li>
              <li>
                <Link
                  href="/policies/additional-policies"
                  className="text-gray-300 hover:text-blue-400 text-sm transition-colors duration-200 flex items-center space-x-2"
                >
                  <FileText className="h-3 w-3" />
                  <span>Disclaimer Policies</span>
                </Link>
              </li>
            </ul>
          </div>

          {/* Support & Help */}
          <div className="space-y-4">
            <h4 className="text-lg font-semibold text-white">Support & Help</h4>
            <ul className="space-y-2">
              <li>
                <Link
                  href="/help/faqs"
                  className="text-gray-300 hover:text-blue-400 text-sm transition-colors duration-200 flex items-center space-x-2"
                >
                  <HelpCircle className="h-3 w-3" />
                  <span>FAQs</span>
                </Link>
              </li>
              <li>
                <Link
                  href="/policies/about-us"
                  className="text-gray-300 hover:text-blue-400 text-sm transition-colors duration-200 flex items-center space-x-2"
                >
                  <Info className="h-3 w-3" />
                  <span>About Us</span>
                </Link>
              </li>
              <li>
                <Link
                  href="/contact-us"
                  className="text-gray-300 hover:text-blue-400 text-sm transition-colors duration-200"
                >
                  Contact Support
                </Link>
              </li>
            </ul>
          </div>
        </div>

      
      </div>

      {/* Bottom Bar */}
      <div className="bg-gray-800 py-4">
        <div className="container mx-auto px-4">
          <div className="flex justify-center items-center">
            <div className="text-sm text-gray-400">
              © 2026 WisRight Technologies Pvt Ltd. All rights reserved.
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default PatientFooter;