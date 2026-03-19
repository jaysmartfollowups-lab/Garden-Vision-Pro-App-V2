import React, { useState } from 'react';
import { signInWithPopup, signInWithRedirect, GoogleAuthProvider } from 'firebase/auth';
import { auth } from '../firebase';
import { Trees, Sparkles, ArrowRight, ShieldCheck, Zap, Globe } from 'lucide-react';
import { motion } from 'motion/react';

export function Login() {
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async () => {
    setIsLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithRedirect(auth, provider);
    } catch (error) {
      console.error('Login failed', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FDFCFB] flex flex-col lg:flex-row overflow-hidden">
      {/* Visual Side */}
      <div className="hidden lg:flex flex-1 bg-zinc-900 relative items-center justify-center p-12">
        <div className="absolute inset-0 overflow-hidden opacity-40">
          <img 
            src="https://images.unsplash.com/photo-1558904541-efa8c1965f1e?q=80&w=2000&auto=format&fit=crop" 
            alt="Beautiful Garden" 
            className="w-full h-full object-cover grayscale"
          />
          <div className="absolute inset-0 bg-gradient-to-tr from-zinc-900 via-zinc-900/80 to-transparent" />
        </div>
        
        <div className="relative z-10 max-w-xl space-y-8">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-emerald-500 rounded-3xl flex items-center justify-center shadow-2xl shadow-emerald-500/20">
              <Trees className="text-white" size={32} />
            </div>
            <h1 className="text-5xl font-black text-white tracking-tight">GardenVision <span className="text-emerald-500">Pro</span></h1>
          </div>
          
          <p className="text-2xl text-zinc-400 font-medium leading-relaxed">
            The ultimate AI-powered design tool for professional landscapers. 
            Transform client gardens in real-time with the power of Gemini.
          </p>
          
          <div className="grid grid-cols-2 gap-6 pt-8">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-emerald-400 font-bold uppercase tracking-widest text-xs">
                <Zap size={14} />
                Instant Vision
              </div>
              <p className="text-zinc-500 text-sm">Generate high-fidelity garden transformations in seconds.</p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-emerald-400 font-bold uppercase tracking-widest text-xs">
                <ShieldCheck size={14} />
                Site Integrity
              </div>
              <p className="text-zinc-500 text-sm">Maintain exact dimensions and architectural details.</p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-emerald-400 font-bold uppercase tracking-widest text-xs">
                <Globe size={14} />
                UK Climate
              </div>
              <p className="text-zinc-500 text-sm">AI-suggested plants optimized for British weather.</p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-emerald-400 font-bold uppercase tracking-widest text-xs">
                <Sparkles size={14} />
                Iterative Design
              </div>
              <p className="text-zinc-500 text-sm">Refine specific areas with our advanced masking tool.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Login Side */}
      <div className="flex-1 flex flex-col items-center justify-center p-8 lg:p-24 bg-white">
        <div className="w-full max-w-sm space-y-12">
          <div className="lg:hidden flex items-center gap-3 mb-12">
            <div className="w-10 h-10 bg-emerald-500 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-200">
              <Trees className="text-white" size={24} />
            </div>
            <h1 className="font-black text-xl tracking-tight text-zinc-900">GardenVision</h1>
          </div>

          <div className="space-y-4">
            <h2 className="text-4xl font-black text-zinc-900 tracking-tight">Welcome Back</h2>
            <p className="text-zinc-400 font-medium">Sign in to access your projects and client designs.</p>
          </div>

          <div className="space-y-4">
            <button 
              onClick={handleLogin}
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-4 py-4 bg-white border-2 border-zinc-100 rounded-2xl font-bold text-zinc-900 hover:border-emerald-500 hover:bg-emerald-50 transition-all shadow-sm group"
            >
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" />
                  Continue with Google
                  <ArrowRight size={18} className="text-zinc-300 group-hover:text-emerald-500 group-hover:translate-x-1 transition-all" />
                </>
              )}
            </button>
            <p className="text-center text-[10px] text-zinc-400 uppercase tracking-widest font-bold">
              Secure Professional Access Only
            </p>
          </div>

          <div className="pt-24">
            <div className="p-6 bg-zinc-50 rounded-3xl space-y-4">
              <div className="flex items-center gap-2 text-zinc-900 font-bold text-sm">
                <Sparkles size={16} className="text-emerald-500" />
                Latest Update
              </div>
              <p className="text-xs text-zinc-500 leading-relaxed">
                Version 2.0 now includes <span className="font-bold text-zinc-900">Iterative Masking</span>. 
                Redesign specific flower beds or patio areas without changing the entire garden.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
