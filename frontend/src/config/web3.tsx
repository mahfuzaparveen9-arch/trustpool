"use client";

import { WagmiProvider, createConfig, http } from "wagmi";
import { baseSepolia, foundry } from "wagmi/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, lightTheme } from "@rainbow-me/rainbowkit";
import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { type ReactNode } from "react";

const config = getDefaultConfig({
  appName: "TrustPool",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "demo",
  chains: [foundry, baseSepolia],
  transports: {
    [foundry.id]: http("http://127.0.0.1:8545"),
    [baseSepolia.id]: http(),
  },
});

const queryClient = new QueryClient();

export function Web3Provider({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={lightTheme({
            accentColor: "#22c55e",
            accentColorForeground: "white",
            borderRadius: "medium",
          })}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

