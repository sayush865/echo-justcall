import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Search, MessageSquare, TrendingUp, Users, Zap, Shield } from "lucide-react";

const Index = () => {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-muted/20 to-background">
      {/* Hero Section */}
      <section className="container mx-auto px-4 pt-20 pb-32">
        <div className="text-center space-y-8 animate-fade-in">
          <div className="inline-block">
            <div className="flex items-center gap-3 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 mb-8">
              <div className="w-2 h-2 rounded-full bg-primary animate-glow"></div>
              <span className="text-sm font-medium text-primary">AI-Powered Customer Intelligence</span>
            </div>
          </div>
          
          <h1 className="text-6xl md:text-7xl lg:text-8xl font-bold tracking-tight">
            <span className="bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent">
              The AI That Brings
            </span>
            <br />
            <span className="bg-gradient-to-r from-primary via-primary-glow to-primary bg-clip-text text-transparent">
              The Voice of Customers
            </span>
            <br />
            <span className="bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent">
              Back to You
            </span>
          </h1>

          <p className="text-xl md:text-2xl text-muted-foreground max-w-3xl mx-auto leading-relaxed">
            For product, sales, success, and support teams who struggle to access insights buried across calls, meetings, and tickets
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center pt-8">
            <Button size="lg" className="text-lg px-8 py-6 rounded-full bg-primary hover:bg-primary/90 shadow-[0_0_30px_hsl(var(--primary)/0.3)]">
              Get Started
              <Zap className="ml-2 h-5 w-5" />
            </Button>
            <Button size="lg" variant="outline" className="text-lg px-8 py-6 rounded-full border-2">
              Watch Demo
            </Button>
          </div>
        </div>
      </section>

      {/* Problem Statement */}
      <section className="container mx-auto px-4 py-20">
        <div className="max-w-4xl mx-auto text-center space-y-6">
          <h2 className="text-3xl md:text-4xl font-bold">
            Customer insights are scattered everywhere
          </h2>
          <p className="text-lg text-muted-foreground">
            Unlike scattered CRMs, call recordings, or support tools, Echo unifies all customer interactions 
            into a searchable RAG system, delivering instant answers, insights, and trends through a single, intelligent interface.
          </p>
        </div>
      </section>

      {/* Features Grid */}
      <section className="container mx-auto px-4 py-20">
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          <Card className="p-8 bg-card border-border hover:border-primary/50 transition-all duration-300 hover:shadow-[0_0_30px_hsl(var(--primary)/0.1)]">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-6">
              <Search className="w-7 h-7 text-primary" />
            </div>
            <h3 className="text-2xl font-bold mb-4">Instant Search</h3>
            <p className="text-muted-foreground leading-relaxed">
              Search across all customer interactions using natural language. Get answers in seconds, not hours.
            </p>
          </Card>

          <Card className="p-8 bg-card border-border hover:border-primary/50 transition-all duration-300 hover:shadow-[0_0_30px_hsl(var(--primary)/0.1)]">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-6">
              <MessageSquare className="w-7 h-7 text-primary" />
            </div>
            <h3 className="text-2xl font-bold mb-4">Unified Voice</h3>
            <p className="text-muted-foreground leading-relaxed">
              Calls, meetings, tickets, and chats all in one place. Never miss what customers are really saying.
            </p>
          </Card>

          <Card className="p-8 bg-card border-border hover:border-primary/50 transition-all duration-300 hover:shadow-[0_0_30px_hsl(var(--primary)/0.1)]">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-6">
              <TrendingUp className="w-7 h-7 text-primary" />
            </div>
            <h3 className="text-2xl font-bold mb-4">Smart Insights</h3>
            <p className="text-muted-foreground leading-relaxed">
              AI-powered analysis reveals patterns, sentiment, and trends automatically across all interactions.
            </p>
          </Card>

          <Card className="p-8 bg-card border-border hover:border-primary/50 transition-all duration-300 hover:shadow-[0_0_30px_hsl(var(--primary)/0.1)]">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-6">
              <Users className="w-7 h-7 text-primary" />
            </div>
            <h3 className="text-2xl font-bold mb-4">Team Alignment</h3>
            <p className="text-muted-foreground leading-relaxed">
              Product, sales, success, and support all work from the same customer intelligence.
            </p>
          </Card>

          <Card className="p-8 bg-card border-border hover:border-primary/50 transition-all duration-300 hover:shadow-[0_0_30px_hsl(var(--primary)/0.1)]">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-6">
              <Zap className="w-7 h-7 text-primary" />
            </div>
            <h3 className="text-2xl font-bold mb-4">Real-time Updates</h3>
            <p className="text-muted-foreground leading-relaxed">
              Every customer interaction is automatically processed and made searchable within minutes.
            </p>
          </Card>

          <Card className="p-8 bg-card border-border hover:border-primary/50 transition-all duration-300 hover:shadow-[0_0_30px_hsl(var(--primary)/0.1)]">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-6">
              <Shield className="w-7 h-7 text-primary" />
            </div>
            <h3 className="text-2xl font-bold mb-4">Enterprise Secure</h3>
            <p className="text-muted-foreground leading-relaxed">
              Bank-level security with SOC2 compliance. Your customer data is protected and private.
            </p>
          </Card>
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-4 py-32">
        <div className="max-w-4xl mx-auto text-center space-y-8 p-12 rounded-3xl bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border border-primary/20">
          <h2 className="text-4xl md:text-5xl font-bold">
            Ready to hear what your customers are really saying?
          </h2>
          <p className="text-xl text-muted-foreground">
            Join teams who've transformed scattered customer data into strategic intelligence.
          </p>
          <Button size="lg" className="text-lg px-8 py-6 rounded-full bg-primary hover:bg-primary/90 shadow-[0_0_30px_hsl(var(--primary)/0.3)]">
            Start Your Free Trial
          </Button>
        </div>
      </section>
    </div>
  );
};

export default Index;
