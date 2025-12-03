import { cn } from "@/lib/utils";

interface EchoLogoProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

export const EchoLogo = ({ size = "md", className }: EchoLogoProps) => {
  const sizeClasses = {
    sm: "w-6 h-6 text-xs",
    md: "w-8 h-8 text-sm",
    lg: "w-10 h-10 text-base",
  };

  return (
    <div
      className={cn(
        "rounded-full bg-gradient-to-br from-primary to-aqua flex items-center justify-center flex-shrink-0 shadow-sm",
        sizeClasses[size],
        className
      )}
    >
      <span className="font-bold text-white">E</span>
    </div>
  );
};
