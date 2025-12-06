import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Sparkles, Star } from "lucide-react";
import { toast } from "sonner";

interface FeedbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const getConfidenceMessage = (rating: number): { text: string; emoji: string } => {
  switch (rating) {
    case 1:
      return { text: "Ayush's confidence grew by 1... he'll take what he can get", emoji: "😅" };
    case 2:
      return { text: "Ayush's confidence grew by 2... room for improvement, noted!", emoji: "🙃" };
    case 3:
      return { text: "Ayush's confidence grew by 3! Perfectly balanced", emoji: "😌" };
    case 4:
      return { text: "Ayush's confidence grew by 4! Almost there... what did he miss?", emoji: "🤔" };
    case 5:
      return { text: "Ayush's confidence grew by 5! You're officially his favorite person!", emoji: "🤩" };
    default:
      return { text: "Slide to rate your experience", emoji: "🎚️" };
  }
};

export const FeedbackDialog = ({ open, onOpenChange }: FeedbackDialogProps) => {
  const { user } = useAuth();
  const [rating, setRating] = useState<number>(0);
  const [feedbackText, setFeedbackText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async () => {
    if (rating === 0) return;
    
    setSubmitting(true);
    try {
      const { error } = await supabase.from("user_feedback").insert({
        user_id: user?.id || null,
        user_email: user?.email || null,
        display_name: user?.user_metadata?.display_name || null,
        rating,
        feedback_text: feedbackText.trim() || null,
      });

      if (error) throw error;
      
      setSubmitted(true);
      
      // Auto-close after 2.5 seconds
      setTimeout(() => {
        onOpenChange(false);
        // Reset state after dialog closes
        setTimeout(() => {
          setRating(0);
          setFeedbackText("");
          setSubmitted(false);
        }, 300);
      }, 2500);
    } catch (error) {
      console.error("Failed to submit feedback:", error);
      toast.error("Failed to submit feedback. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const confidenceMessage = getConfidenceMessage(rating);
  const displayRating = rating || 3; // Show middle state visually when not selected

  return (
    <Dialog open={open} onOpenChange={(newOpen) => {
      if (!newOpen && !submitted) {
        // Reset when closing without submit
        setRating(0);
        setFeedbackText("");
      }
      onOpenChange(newOpen);
    }}>
      <DialogContent className="sm:max-w-md">
        {!submitted ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-center text-lg">How's Echo working for you?</DialogTitle>
            </DialogHeader>
            
            <div className="flex flex-col items-center gap-6 py-4">
              {/* Live Emoji Display */}
              <div className="text-5xl transition-all duration-300 ease-out transform">
                {confidenceMessage.emoji}
              </div>

              {/* Slider Rating */}
              <div className="w-full space-y-3">
                <Slider
                  value={[displayRating]}
                  onValueChange={(value) => setRating(value[0])}
                  min={1}
                  max={5}
                  step={1}
                  className="w-full [&_[role=slider]]:bg-yellow-400 [&_[role=slider]]:border-yellow-500 [&_.bg-primary]:bg-yellow-400"
                />
                {/* Number Labels */}
                <div className="flex justify-between px-1 text-sm text-muted-foreground">
                  {[1, 2, 3, 4, 5].map((num) => (
                    <span 
                      key={num} 
                      className={`transition-colors ${rating === num ? 'text-yellow-500 font-medium' : ''}`}
                    >
                      {num}
                    </span>
                  ))}
                </div>
              </div>

              {/* Live Confidence Message */}
              <div className="text-center min-h-[48px] transition-all duration-300">
                <p className={`text-sm ${rating > 0 ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {confidenceMessage.text}
                </p>
              </div>

              {/* Feedback Text */}
              <div className="w-full space-y-2">
                <Textarea
                  placeholder="Any feedback? (optional)"
                  value={feedbackText}
                  onChange={(e) => setFeedbackText(e.target.value)}
                  className="min-h-[80px] resize-none"
                  maxLength={1000}
                />
                <p className="text-xs text-muted-foreground text-right">
                  {feedbackText.length}/1000
                </p>
              </div>

              {/* Submit Button */}
              <Button
                onClick={handleSubmit}
                disabled={rating === 0 || submitting}
                className="w-full"
              >
                {submitting ? (
                  <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                ) : (
                  "Submit Feedback"
                )}
              </Button>
            </div>
          </>
        ) : (
          // Success State with Confidence Message
          <div className="flex flex-col items-center justify-center py-8 gap-4">
            <div className="relative">
              <Sparkles className="w-12 h-12 text-yellow-400 animate-pulse" />
              <div className="absolute -top-1 -right-1 w-4 h-4 bg-yellow-400 rounded-full animate-ping" />
            </div>
            <div className="text-center space-y-2">
              <p className="text-lg font-medium">{confidenceMessage.text}</p>
              <p className="text-4xl">{confidenceMessage.emoji}</p>
            </div>
            <div className="flex items-center gap-1 mt-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <Star
                  key={star}
                  className={`w-5 h-5 ${
                    star <= rating
                      ? "fill-yellow-400 text-yellow-400"
                      : "text-muted-foreground/40"
                  }`}
                />
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
