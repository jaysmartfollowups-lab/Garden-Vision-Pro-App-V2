import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';

interface VoiceInputProps {
  value: string;
  onTranscript: (text: string) => void;
  className?: string;
  placeholder?: string;
}

export function VoiceInput({ value, onTranscript, className, placeholder }: VoiceInputProps) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState(value);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    setTranscript(value);
  }, [value]);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;

      recognitionRef.current.onresult = (event: any) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }

        const currentTranscript = finalTranscript || interimTranscript;
        setTranscript(currentTranscript);
        if (currentTranscript) {
          onTranscript(currentTranscript);
        }
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error('Speech recognition error', event.error);
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
    }
  }, [onTranscript]);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      setTranscript('');
      recognitionRef.current?.start();
      setIsListening(true);
    }
  };

  return (
    <div className={cn("relative w-full", className)}>
      <textarea
        value={transcript}
        onChange={(e) => {
          setTranscript(e.target.value);
          onTranscript(e.target.value);
        }}
        placeholder={placeholder || "Describe the transformation..."}
        className="w-full min-h-[120px] p-4 pr-12 rounded-xl border-2 border-zinc-100 focus:border-emerald-500 focus:ring-0 transition-all bg-white/50 backdrop-blur-sm text-zinc-800 placeholder:text-zinc-400 resize-none"
      />
      <button
        onClick={toggleListening}
        className={cn(
          "absolute top-4 right-4 p-2 rounded-full transition-all",
          isListening 
            ? "bg-red-500 text-white animate-pulse shadow-lg shadow-red-200" 
            : "bg-zinc-100 text-zinc-500 hover:bg-emerald-500 hover:text-white"
        )}
      >
        {isListening ? <MicOff size={20} /> : <Mic size={20} />}
      </button>
      {isListening && (
        <div className="absolute bottom-4 left-4 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-red-500">
          <Loader2 size={12} className="animate-spin" />
          Listening...
        </div>
      )}
    </div>
  );
}
