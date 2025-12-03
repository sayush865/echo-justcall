import { cn } from "@/lib/utils";

interface EchoLogoProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

export const EchoLogo = ({ size = "md", className }: EchoLogoProps) => {
  const sizeClasses = {
    sm: "w-6 h-6",
    md: "w-8 h-8",
    lg: "w-10 h-10",
  };

  return (
    <div
      className={cn(
        "flex items-center justify-center flex-shrink-0",
        sizeClasses[size],
        className
      )}
    >
      <svg
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full"
      >
        <defs>
          {/* Gradient for speakers */}
          <linearGradient id="speakerGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="hsl(227, 93%, 60%)" />
            <stop offset="100%" stopColor="hsl(195, 100%, 65%)" />
          </linearGradient>
          {/* Background gradient */}
          <linearGradient id="bgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="hsl(227, 93%, 60%)" />
            <stop offset="50%" stopColor="hsl(256, 100%, 68%)" />
            <stop offset="100%" stopColor="hsl(195, 100%, 65%)" />
          </linearGradient>
        </defs>
        
        {/* Background circle */}
        <circle cx="50" cy="50" r="48" fill="url(#bgGradient)" />
        
        {/* Left speaker */}
        <g>
          {/* Outer ring */}
          <circle cx="18" cy="50" r="12" fill="hsl(237, 47%, 32%)" />
          {/* Middle ring */}
          <circle cx="18" cy="50" r="9" fill="hsl(227, 93%, 50%)" />
          {/* Inner circle */}
          <circle cx="18" cy="50" r="5" fill="hsl(195, 100%, 65%)" />
          {/* Center dot */}
          <circle cx="18" cy="50" r="2" fill="hsl(237, 47%, 32%)" />
        </g>
        
        {/* Right speaker */}
        <g>
          {/* Outer ring */}
          <circle cx="82" cy="50" r="12" fill="hsl(237, 47%, 32%)" />
          {/* Middle ring */}
          <circle cx="82" cy="50" r="9" fill="hsl(227, 93%, 50%)" />
          {/* Inner circle */}
          <circle cx="82" cy="50" r="5" fill="hsl(195, 100%, 65%)" />
          {/* Center dot */}
          <circle cx="82" cy="50" r="2" fill="hsl(237, 47%, 32%)" />
        </g>
        
        {/* Face - white rounded rectangle */}
        <rect
          x="25"
          y="25"
          width="50"
          height="50"
          rx="12"
          fill="white"
        />
        
        {/* Left eye */}
        <circle cx="40" cy="42" r="5" fill="hsl(237, 47%, 20%)" />
        {/* Left eye highlight */}
        <circle cx="38" cy="40" r="1.5" fill="white" />
        
        {/* Right eye */}
        <circle cx="60" cy="42" r="5" fill="hsl(237, 47%, 20%)" />
        {/* Right eye highlight */}
        <circle cx="58" cy="40" r="1.5" fill="white" />
        
        {/* Smile */}
        <path
          d="M 40 58 Q 50 66 60 58"
          stroke="hsl(237, 47%, 20%)"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
        
        {/* Sound waves - left */}
        <path
          d="M 8 38 Q 2 50 8 62"
          stroke="white"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
          opacity="0.6"
        />
        <path
          d="M 4 32 Q -4 50 4 68"
          stroke="white"
          strokeWidth="1.5"
          strokeLinecap="round"
          fill="none"
          opacity="0.3"
        />
        
        {/* Sound waves - right */}
        <path
          d="M 92 38 Q 98 50 92 62"
          stroke="white"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
          opacity="0.6"
        />
        <path
          d="M 96 32 Q 104 50 96 68"
          stroke="white"
          strokeWidth="1.5"
          strokeLinecap="round"
          fill="none"
          opacity="0.3"
        />
      </svg>
    </div>
  );
};
