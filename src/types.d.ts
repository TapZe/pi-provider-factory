import type { UsageProvider } from "@oh-my-pi/pi-ai";

declare module "@oh-my-pi/pi-coding-agent" {
  interface ProviderConfig {
    usage?: UsageProvider | Omit<UsageProvider, "id">;
    usageProvider?: UsageProvider | Omit<UsageProvider, "id">;
  }
}

declare module "@oh-my-pi/pi-ai" {
  interface UsageReport {
    notes?: string[];
  }
}
