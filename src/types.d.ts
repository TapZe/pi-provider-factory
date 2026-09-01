import type { UsageProvider } from "@oh-my-pi/pi-ai";

declare module "@oh-my-pi/pi-coding-agent" {
  interface ProviderConfig {
    usageProvider?: UsageProvider | Omit<UsageProvider, "id">;
  }
}

declare module "@oh-my-pi/pi-ai" {
  interface UsageReport {
    notes?: string[];
  }
}
