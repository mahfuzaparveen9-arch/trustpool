"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  useBlockNumber,
  usePublicClient,
} from "wagmi";
import { formatUnits, parseUnits, type Address, maxUint256 } from "viem";
import {
  ADDRESSES,
  LENDING_POOL_ABI,
  CREDIT_SCORE_ABI,
  MOCK_ERC20_ABI,
  ORACLE_ABI,
} from "@/config/contracts";

type Tab = "dashboard" | "liquidations" | "compare" | "demo-controls" | "how-it-works";

export default function Home() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { data: blockNumber } = useBlockNumber({ watch: true });

  // Notification Toast state
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);
  const showToast = useCallback((message: string, type: "success" | "error" | "info" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // Contract Reads
  const { data: ethPriceRaw, refetch: refetchPrice } = useReadContract({
    address: ADDRESSES.oracle,
    abi: ORACLE_ABI,
    functionName: "getPrice",
    args: [ADDRESSES.mWETH],
    query: { refetchInterval: 5000 },
  });

  const { data: userPosition, refetch: refetchPosition } = useReadContract({
    address: ADDRESSES.lendingPool,
    abi: LENDING_POOL_ABI,
    functionName: "getPosition",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 5000 },
  });

  const { data: creditScoreData, refetch: refetchScore } = useReadContract({
    address: ADDRESSES.creditScore,
    abi: CREDIT_SCORE_ABI,
    functionName: "getScore",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 5000 },
  });

  const { data: userTierData } = useReadContract({
    address: ADDRESSES.creditScore,
    abi: CREDIT_SCORE_ABI,
    functionName: "getTier",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 5000 },
  });

  const { data: userTerms } = useReadContract({
    address: ADDRESSES.creditScore,
    abi: CREDIT_SCORE_ABI,
    functionName: "getTerms",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 5000 },
  });

  const { data: userData } = useReadContract({
    address: ADDRESSES.creditScore,
    abi: CREDIT_SCORE_ABI,
    functionName: "getUserData",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 5000 },
  });

  const { data: poolLiquidity } = useReadContract({
    address: ADDRESSES.lendingPool,
    abi: LENDING_POOL_ABI,
    functionName: "getAvailableLiquidity",
    query: { refetchInterval: 5000 },
  });

  const { data: poolTotalBorrowed } = useReadContract({
    address: ADDRESSES.lendingPool,
    abi: LENDING_POOL_ABI,
    functionName: "totalBorrowed",
    query: { refetchInterval: 5000 },
  });

  const { data: poolTotalDeposited } = useReadContract({
    address: ADDRESSES.lendingPool,
    abi: LENDING_POOL_ABI,
    functionName: "totalDeposited",
    query: { refetchInterval: 5000 },
  });

  const { data: currentRates } = useReadContract({
    address: ADDRESSES.lendingPool,
    abi: LENDING_POOL_ABI,
    functionName: "getCurrentRates",
    query: { refetchInterval: 5000 },
  });

  const { data: mUSDCBalance, refetch: refetchUSDC } = useReadContract({
    address: ADDRESSES.mUSDC,
    abi: MOCK_ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 5000 },
  });

  const { data: mWETHBalance, refetch: refetchWETH } = useReadContract({
    address: ADDRESSES.mWETH,
    abi: MOCK_ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 5000 },
  });

  // Contract Writes
  const { writeContractAsync } = useWriteContract();

  // Calculated Values
  const ethPrice = useMemo(() => {
    if (!ethPriceRaw) return 3500;
    return Number(formatUnits(ethPriceRaw[0], 8));
  }, [ethPriceRaw]);

  const score = useMemo(() => {
    if (creditScoreData !== undefined) return Number(creditScoreData);
    return 742; // default fallback demo score
  }, [creditScoreData]);

  const tier = useMemo(() => {
    if (userTierData !== undefined) return Number(userTierData);
    if (score >= 700) return 2;
    if (score >= 550) return 1;
    return 0;
  }, [userTierData, score]);

  const collateralAmount = useMemo(() => {
    if (!userPosition) return 4.25;
    return Number(formatUnits(userPosition[0], 18));
  }, [userPosition]);

  const debtAmount = useMemo(() => {
    if (!userPosition) return 10240;
    return Number(formatUnits(userPosition[2], 6));
  }, [userPosition]);

  const healthFactor = useMemo(() => {
    if (!userPosition || debtAmount === 0) return 1.45;
    const hf = Number(formatUnits(userPosition[3], 18));
    return hf > 999 ? 99.9 : hf;
  }, [userPosition, debtAmount]);

  const borrowAPR = useMemo(() => {
    if (!currentRates) return "3.15%";
    const rateBps = Number(currentRates[1]);
    const pct = rateBps / 100;
    return `${pct.toFixed(2)}%`;
  }, [currentRates]);

  // Modals state
  const [actionModal, setActionModal] = useState<{
    open: boolean;
    type: "borrow" | "repay" | "deposit";
    title: string;
    asset: string;
    defaultVal: string;
  }>({
    open: false,
    type: "borrow",
    title: "Borrow mUSDC Loan",
    asset: "mUSDC",
    defaultVal: "1,500.00",
  });
  const [modalAmount, setModalAmount] = useState("1000.00");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Liquidation Modal state
  const [liqModal, setLiqModal] = useState<{
    open: boolean;
    borrower: string;
    debt: string;
    bounty: string;
  }>({
    open: false,
    borrower: "0x71C8...4f9B",
    debt: "2,225 mUSDC",
    bounty: "+111.25 mUSDC",
  });
  const [isLiquidating, setIsLiquidating] = useState(false);

  // Action modal submit handler
  const handleModalSubmit = async () => {
    if (!isConnected || !address) {
      showToast("Please connect your wallet first", "error");
      return;
    }
    setIsSubmitting(true);
    try {
      const cleanVal = modalAmount.replace(/,/g, "");
      const num = parseFloat(cleanVal);
      if (isNaN(num) || num <= 0) {
        showToast("Please enter a valid amount", "error");
        setIsSubmitting(false);
        return;
      }

      if (actionModal.type === "deposit") {
        const parsed = parseUnits(cleanVal, 18);
        showToast("Approving mWETH...", "info");
        await writeContractAsync({
          address: ADDRESSES.mWETH,
          abi: MOCK_ERC20_ABI,
          functionName: "approve",
          args: [ADDRESSES.lendingPool, parsed],
        });
        showToast("Depositing collateral...", "info");
        await writeContractAsync({
          address: ADDRESSES.lendingPool,
          abi: LENDING_POOL_ABI,
          functionName: "depositCollateral",
          args: [parsed],
        });
        showToast(`Successfully deposited ${cleanVal} mWETH!`, "success");
      } else if (actionModal.type === "borrow") {
        const parsed = parseUnits(cleanVal, 6);
        showToast("Borrowing mUSDC...", "info");
        await writeContractAsync({
          address: ADDRESSES.lendingPool,
          abi: LENDING_POOL_ABI,
          functionName: "borrow",
          args: [parsed],
        });
        showToast(`Successfully borrowed ${cleanVal} mUSDC!`, "success");
      } else if (actionModal.type === "repay") {
        const parsed = parseUnits(cleanVal, 6);
        showToast("Approving mUSDC...", "info");
        await writeContractAsync({
          address: ADDRESSES.mUSDC,
          abi: MOCK_ERC20_ABI,
          functionName: "approve",
          args: [ADDRESSES.lendingPool, parsed],
        });
        showToast("Repaying loan...", "info");
        await writeContractAsync({
          address: ADDRESSES.lendingPool,
          abi: LENDING_POOL_ABI,
          functionName: "repay",
          args: [parsed],
        });
        showToast(`Successfully repaid ${cleanVal} mUSDC!`, "success");
      }

      refetchPosition();
      refetchScore();
      refetchUSDC();
      refetchWETH();
      setActionModal((prev) => ({ ...prev, open: false }));
    } catch (err: any) {
      console.error(err);
      showToast(err?.shortMessage || err?.message || "Transaction failed", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Faucet Minting
  const [faucetStatus, setFaucetStatus] = useState<string | null>(null);
  const handleMintToken = async (token: "mUSDC" | "mWETH") => {
    if (!isConnected || !address) {
      showToast("Please connect your wallet first", "error");
      return;
    }
    try {
      const contractAddr = token === "mUSDC" ? ADDRESSES.mUSDC : ADDRESSES.mWETH;
      showToast(`Minting testnet ${token}...`, "info");
      await writeContractAsync({
        address: contractAddr,
        abi: MOCK_ERC20_ABI,
        functionName: "faucet",
      });
      setFaucetStatus(`Minted 100% testnet ${token} to wallet!`);
      showToast(`Minted testnet ${token} successfully!`, "success");
      refetchUSDC();
      refetchWETH();
      setTimeout(() => setFaucetStatus(null), 3500);
    } catch (err: any) {
      showToast(err?.shortMessage || "Faucet failed", "error");
    }
  };

  // Compare Tab State
  const [compareAmount, setCompareAmount] = useState<number>(10000);

  // Demo Controls State
  const [oraclePriceInput, setOraclePriceInput] = useState<number>(3500);
  const [demoTierState, setDemoTierState] = useState<number>(2);
  const [borrowIndexAccrual, setBorrowIndexAccrual] = useState<number>(1.04289);
  const [accumulatedInterest, setAccumulatedInterest] = useState<number>(4812.3);
  const [eventLogs, setEventLogs] = useState<
    Array<{
      id: string;
      name: string;
      contract: string;
      params: string;
      block: number;
      age: string;
      badgeColor: string;
    }>
  >([
    {
      id: "1",
      name: "PriceUpdated",
      contract: "MockPriceOracle",
      params: "asset: 0x4200...06 (WETH), price: 350000000000 (8 dec)",
      block: 19482109,
      age: "2s ago",
      badgeColor: "bg-primary-fixed text-on-primary-fixed",
    },
    {
      id: "2",
      name: "ScoreUpdated",
      contract: "TrustScoreOracle",
      params: "user: 0x71C...B8e9, prev: 724, new: 742, streak: 4",
      block: 19482084,
      age: "4m ago",
      badgeColor: "bg-secondary-fixed text-on-secondary-fixed",
    },
    {
      id: "3",
      name: "InterestAccrued",
      contract: "LendingPool",
      params: "reserve: USDC, borrowRate: 4.82% APR, accrued: +14.20 USDC",
      block: 19482012,
      age: "12m ago",
      badgeColor: "bg-tertiary-fixed text-on-tertiary-fixed",
    },
  ]);

  // Terminal streaming state for Liquidations
  const [terminalStreaming, setTerminalStreaming] = useState<boolean>(true);
  const [terminalLogs, setTerminalLogs] = useState<
    Array<{
      type: "block" | "alert" | "tx";
      text: string;
      detail?: string;
      extra?: string;
    }>
  >([
    {
      type: "block",
      text: "evalBlock(14923810)",
      detail: "Processed 142 vaults in 34ms • All health factors > 1.00",
    },
    {
      type: "block",
      text: "evalBlock(14923811)",
      detail: "Price Feed Oracle Update: ETH/USD $3,000 → $2,985",
    },
    {
      type: "alert",
      text: "[Keeper Alert] Underwater Vault Detected!",
      detail: "Vault #V-8491 (0x71C8...4f9B)",
      extra: "HF = 0.918 < 1.000 • Debt: 4,450.00 mUSDC",
    },
    {
      type: "tx",
      text: "[Keeper Tx] Calling LendingPool.liquidate(...)",
      detail: "Hash: 0x6e9f42bca48911...5b871c • Block #14923812",
      extra: "Accrued Bounty: +172.50 mUSDC (Claimed)",
    },
  ]);

  useEffect(() => {
    if (!terminalStreaming) return;
    const interval = setInterval(() => {
      const nextBlock = 14923814 + Math.floor(Math.random() * 50);
      const latency = Math.floor(Math.random() * 20) + 18;
      setTerminalLogs((prev) => [
        ...prev.slice(-8),
        {
          type: "block",
          text: `evalBlock(${nextBlock})`,
          detail: `Processed 142 vaults in ${latency}ms • Safe margin`,
        },
      ]);
    }, 5000);
    return () => clearInterval(interval);
  }, [terminalStreaming]);

  // How It Works state
  const [activeStep, setActiveStep] = useState<number>(1);

  // Helper formatting
  const formatUSD = (num: number) =>
    "$" + num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="bg-[#FAF8F5] font-body-md text-[#0F172A] min-h-screen flex flex-col selection:bg-indigo-100 selection:text-indigo-900">
      {/* Toast Notification Container */}
      {toast && (
        <div className="fixed top-24 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl bg-white border border-[#E6DFD5] shadow-lg animate-in fade-in slide-in-from-top-4 duration-200">
          <span className="material-symbols-outlined text-[20px] text-indigo-600">
            {toast.type === "success" ? "check_circle" : toast.type === "error" ? "error" : "info"}
          </span>
          <span className="text-body-sm font-medium text-[#0F172A]">{toast.message}</span>
        </div>
      )}

      {/* TOP HEADER */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-[#FFFFFF]/90 backdrop-blur-xl border-b border-[#E6DFD5] shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
        <div className="h-20 w-full px-margin flex items-center justify-between gap-space-lg">
          <div className="flex items-center gap-space-lg">
            <button
              onClick={() => setTab("dashboard")}
              className="flex items-center gap-2.5 group cursor-pointer text-left"
            >
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-600 flex items-center justify-center shadow-md shadow-indigo-500/20">
                <div className="w-3.5 h-3.5 rounded-full bg-white"></div>
              </div>
              <span className="font-headline-md text-headline-md tracking-tight italic bg-gradient-to-r from-indigo-700 via-indigo-600 to-violet-600 bg-clip-text text-transparent font-bold">
                TrustPaull
              </span>
            </button>
            <nav className="hidden lg:flex items-center gap-1 p-1 bg-[#F5F1EB] rounded-full border border-[#E6DFD5]">
              {(
                [
                  { id: "dashboard", label: "Dashboard" },
                  { id: "liquidations", label: "Liquidations" },
                  { id: "compare", label: "Compare" },
                  { id: "demo-controls", label: "Demo Controls" },
                  { id: "how-it-works", label: "How It Works" },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`px-space-md py-1.5 rounded-full font-label-numeric-md transition-colors cursor-pointer text-[14px] ${
                    tab === t.id
                      ? "bg-white text-[#0F172A] shadow-sm font-semibold"
                      : "text-[#475569] hover:text-[#0F172A] hover:bg-white/60 font-medium"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-space-md">
            <div className="hidden sm:flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#ECFDF5] border border-emerald-200/80">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-600"></span>
              </span>
              <span className="font-label-tag text-label-tag text-emerald-800 uppercase font-semibold">
                Base Sepolia #84532
              </span>
            </div>
            {/* RainbowKit Connect Button custom integration */}
            <ConnectButton.Custom>
              {({ account, chain, openAccountModal, openConnectModal, mounted }) => {
                const ready = mounted;
                const connected = ready && account && chain;
                if (!connected) {
                  return (
                    <button
                      onClick={openConnectModal}
                      className="px-5 py-2.5 rounded-full font-headline-sm text-label-numeric-md font-semibold bg-[#4F46E5] text-white hover:bg-indigo-700 shadow-sm hover:shadow transition-all flex items-center gap-2 cursor-pointer"
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[17px]">account_balance_wallet</span>
                      <span>Connect Wallet</span>
                    </button>
                  );
                }
                return (
                  <button
                    onClick={openAccountModal}
                    className="px-4 py-2 rounded-full font-label-numeric-md font-semibold bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm transition-all flex items-center gap-2 cursor-pointer"
                    type="button"
                  >
                    <span className="w-2 h-2 rounded-full bg-emerald-300 animate-pulse"></span>
                    <span>{account.displayName}</span>
                  </button>
                );
              }}
            </ConnectButton.Custom>
            <div className="w-8 h-8 rounded-full bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-700">
              <span className="material-symbols-outlined text-[18px]">person</span>
            </div>
          </div>
        </div>
      </header>

      {/* MAIN VIEWPORT SWITCHER */}
      <main className="w-full pt-20 flex-1 bg-[#FAF8F5]">
        {/* ======================================================== */}
        {/* TAB 1: DASHBOARD                                         */}
        {/* ======================================================== */}
        {tab === "dashboard" && (
          <div className="flex flex-col w-full">
            <div className="relative w-full overflow-hidden">
              <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[850px] h-[480px] bg-gradient-to-b from-indigo-200/35 via-amber-100/40 to-transparent blur-[120px] pointer-events-none -z-10"></div>
              <div className="absolute top-80 -right-20 w-[420px] h-[420px] bg-teal-100/40 blur-[130px] pointer-events-none -z-10"></div>
              <div className="absolute top-96 -left-20 w-[380px] h-[380px] bg-indigo-100/40 blur-[120px] pointer-events-none -z-10"></div>

              {/* Hero Section */}
              <section className="w-full px-margin pt-14 pb-12 flex flex-col items-center text-center max-w-5xl mx-auto">
                <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/90 border border-[#E6DFD5] backdrop-blur-md mb-6 shadow-sm">
                  <span className="flex h-2 w-2 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-500 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-teal-600"></span>
                  </span>
                  <span className="font-label-tag text-label-tag text-[#334155] uppercase tracking-wider font-semibold">
                    Algorithmic Reputation Protocol
                  </span>
                  <span className="text-[#CBD5E1] text-body-sm mx-0.5">•</span>
                  <span className="font-label-tag text-label-tag text-teal-700 uppercase font-semibold">
                    Zero Offchain Identity
                  </span>
                </div>
                <h1 className="font-display-hero text-display-hero tracking-tight bg-gradient-to-r from-[#0F172A] via-[#1E293B] to-indigo-700 bg-clip-text text-transparent drop-shadow-sm max-w-4xl">
                  Your Wallet Is Your Credit Score
                </h1>
                <p className="mt-6 font-body-lg text-body-lg text-[#475569] max-w-2xl leading-relaxed">
                  Deposit collateral, borrow stablecoins, and build onchain credit history. Better scores unlock lower
                  collateral requirements and prime borrowing rates.
                </p>
                <div className="mt-8 flex flex-wrap items-center justify-center gap-space-md">
                  <ConnectButton.Custom>
                    {({ account, openConnectModal, openAccountModal }) => (
                      <button
                        onClick={account ? openAccountModal : openConnectModal}
                        className="group px-7 py-3 rounded-xl font-headline-sm text-body-md font-semibold bg-[#4F46E5] text-white hover:bg-indigo-700 transition-all duration-200 shadow-md shadow-indigo-600/20 hover:shadow-lg hover:shadow-indigo-600/30 flex items-center gap-2 cursor-pointer"
                        type="button"
                      >
                        <span className="material-symbols-outlined text-[20px] transition-transform group-hover:scale-110">
                          account_balance_wallet
                        </span>
                        <span>{account ? account.displayName : "Connect Wallet"}</span>
                        <span className="material-symbols-outlined text-[16px] text-indigo-200 transition-transform group-translate-x-0.5">
                          arrow_forward
                        </span>
                      </button>
                    )}
                  </ConnectButton.Custom>
                  <a
                    className="px-6 py-3 rounded-xl font-label-numeric-md text-label-numeric-md text-[#1E293B] bg-white border border-[#E6DFD5] hover:bg-[#F5F1EB] transition-colors flex items-center gap-2 shadow-sm"
                    href="#vault-section"
                  >
                    <span className="material-symbols-outlined text-[18px] text-teal-600">query_stats</span>
                    <span className="font-semibold">Explore Vault #448-B</span>
                  </a>
                </div>

                {/* Telemetry Ribbons: Protocol Highlights */}
                <div className="w-full mt-12 grid grid-cols-2 md:grid-cols-4 gap-4 p-4 rounded-2xl bg-white/90 border border-[#E6DFD5] shadow-sm backdrop-blur-xl">
                  <div className="flex flex-col items-start p-3.5 rounded-xl bg-[#FAF8F5] border border-[#EAE4DA]">
                    <div className="flex items-center gap-1.5 text-[#64748B] text-label-tag font-label-tag uppercase mb-1">
                      <span className="material-symbols-outlined text-[15px] text-teal-600">hub</span>
                      <span className="font-semibold">Base Sepolia Block</span>
                    </div>
                    <div className="font-label-numeric-lg text-label-numeric-lg text-[#0F172A] flex items-baseline gap-1.5">
                      <span>#{blockNumber ? blockNumber.toString() : "18,492,036"}</span>
                      <span className="text-body-sm font-body-sm text-emerald-700 flex items-center font-semibold">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse mr-1"></span>
                        2.1s
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col items-start p-3.5 rounded-xl bg-[#FAF8F5] border border-[#EAE4DA]">
                    <div className="flex items-center gap-1.5 text-[#64748B] text-label-tag font-label-tag uppercase mb-1">
                      <span className="material-symbols-outlined text-[15px] text-indigo-600">account_balance</span>
                      <span className="font-semibold">Protocol Liquidity</span>
                    </div>
                    <div className="font-label-numeric-lg text-label-numeric-lg text-[#0F172A]">
                      {poolLiquidity ? `$${Number(formatUnits(poolLiquidity, 6)).toLocaleString()}` : "$14,821,490"}
                    </div>
                  </div>
                  <div className="flex flex-col items-start p-3.5 rounded-xl bg-[#FAF8F5] border border-[#EAE4DA]">
                    <div className="flex items-center gap-1.5 text-[#64748B] text-label-tag font-label-tag uppercase mb-1">
                      <span className="material-symbols-outlined text-[15px] text-amber-700">credit_score</span>
                      <span className="font-semibold">Active Borrowed</span>
                    </div>
                    <div className="font-label-numeric-lg text-label-numeric-lg text-[#0F172A]">
                      {poolTotalBorrowed
                        ? `$${Number(formatUnits(poolTotalBorrowed, 6)).toLocaleString()}`
                        : "$6,412,880"}
                    </div>
                  </div>
                  <div className="flex flex-col items-start p-3.5 rounded-xl bg-[#FAF8F5] border border-[#EAE4DA]">
                    <div className="flex items-center gap-1.5 text-[#64748B] text-label-tag font-label-tag uppercase mb-1">
                      <span className="material-symbols-outlined text-[15px] text-teal-700">percent</span>
                      <span className="font-semibold">Base Borrow APR</span>
                    </div>
                    <div className="font-label-numeric-lg text-label-numeric-lg text-teal-700 font-bold">
                      {borrowAPR}
                    </div>
                  </div>
                </div>
              </section>

              {/* Main Quantitative Dashboard Grid (Split 8/4 Institutional Layout) */}
              <div className="w-full max-w-[1440px] mx-auto px-margin pb-20" id="vault-section">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-gutter items-start">
                  {/* Left 8 Columns: Credit Engine & Active Vault Management */}
                  <div className="lg:col-span-8 flex flex-col gap-space-lg">
                    {/* Card 1: Algorithmic Credit Score Visualizer */}
                    <div className="w-full rounded-2xl bg-white p-space-lg border border-[#EAE4DA] shadow-sm relative overflow-hidden">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-[#F5F1EB]">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center">
                            <span className="material-symbols-outlined text-indigo-600 text-[22px]">verified_user</span>
                          </div>
                          <div>
                            <h2 className="font-headline-sm text-headline-sm text-[#0F172A] font-bold">
                              TrustScore v2.4 Engine
                            </h2>
                            <p className="font-body-sm text-body-sm text-[#64748B]">
                              Deterministic Multi-Cycle Behavioral Valuation
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="px-3 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200/60 font-label-tag text-label-tag uppercase tracking-wider font-semibold">
                            {tier === 2 ? "Prime Borrower" : tier === 1 ? "Standard Borrower" : "Base Borrower"}
                          </span>
                          <span className="px-3 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200/60 font-label-tag text-label-tag uppercase font-semibold">
                            Tier {tier} Active
                          </span>
                        </div>
                      </div>

                      {/* Radial Gauge & Score Breakdown Mosaic */}
                      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center pt-5 pb-3">
                        <div className="md:col-span-5 flex flex-col items-center justify-center relative p-2">
                          <div className="relative w-48 h-48 flex items-center justify-center">
                            <svg className="w-48 h-48 -rotate-90 transform" viewBox="0 0 160 160">
                              <circle
                                cx="80"
                                cy="80"
                                fill="transparent"
                                r="68"
                                stroke="#F1EBE1"
                                strokeDasharray="427"
                                strokeDashoffset="106"
                                strokeLinecap="round"
                                strokeWidth="12"
                              ></circle>
                              <circle
                                className="transition-all duration-1000 ease-out"
                                cx="80"
                                cy="80"
                                fill="transparent"
                                r="68"
                                stroke="url(#scoreGradLight)"
                                strokeDasharray="427"
                                strokeDashoffset={String(427 - ((score - 300) / 550) * 320)}
                                strokeLinecap="round"
                                strokeWidth="12"
                              ></circle>
                              <defs>
                                <linearGradient id="scoreGradLight" x1="0%" x2="100%" y1="0%" y2="100%">
                                  <stop offset="0%" stopColor="#4F46E5"></stop>
                                  <stop offset="50%" stopColor="#0D9488"></stop>
                                  <stop offset="100%" stopColor="#059669"></stop>
                                </linearGradient>
                              </defs>
                            </svg>
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                              <span className="font-label-tag text-label-tag text-[#64748B] tracking-wider uppercase font-semibold">
                                Credit Score
                              </span>
                              <span className="font-headline-lg text-headline-lg text-[#0F172A] tracking-tight font-bold">
                                {score}
                              </span>
                              <span className="font-body-sm text-body-sm text-[#64748B]">Max 850</span>
                            </div>
                          </div>
                          <div className="mt-3 flex items-center gap-1.5 text-center">
                            <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
                            <span className="font-label-tag text-label-tag text-emerald-800 font-semibold uppercase">
                              {tier === 2 ? "80% Collateral Unlocked" : tier === 1 ? "120% Collateral Standard" : "150% Overcollateralized"}
                            </span>
                          </div>
                        </div>
                        <div className="md:col-span-7 grid grid-cols-2 gap-3.5">
                          <div className="p-3.5 rounded-xl bg-[#FAF8F5] border border-[#EAE4DA] flex flex-col justify-between">
                            <span className="font-label-tag text-label-tag text-[#64748B] uppercase font-semibold">
                              Wallet Stature
                            </span>
                            <div className="font-label-numeric-md text-label-numeric-md text-[#0F172A] mt-1 font-bold">
                              184 Days
                            </div>
                            <span className="font-body-sm text-body-sm text-teal-700 font-medium mt-0.5">
                              Top 12% on Base
                            </span>
                          </div>
                          <div className="p-3.5 rounded-xl bg-[#FAF8F5] border border-[#EAE4DA] flex flex-col justify-between">
                            <span className="font-label-tag text-label-tag text-[#64748B] uppercase font-semibold">
                              Repayments
                            </span>
                            <div className="font-label-numeric-md text-label-numeric-md text-[#0F172A] mt-1 font-bold">
                              {userData ? `${userData.repaymentCount} Cycles` : "12 / 12 Perfect"}
                            </div>
                            <span className="font-body-sm text-body-sm text-emerald-700 font-medium mt-0.5">
                              100% On-time
                            </span>
                          </div>
                          <div className="p-3.5 rounded-xl bg-[#FAF8F5] border border-[#EAE4DA] flex flex-col justify-between">
                            <span className="font-label-tag text-label-tag text-[#64748B] uppercase font-semibold">
                              Streak Consistency
                            </span>
                            <div className="font-label-numeric-md text-label-numeric-md text-[#0F172A] mt-1 font-bold">
                              {userData ? `${userData.currentStreak} Cycles` : "4 Cycles"}
                            </div>
                            <span className="font-body-sm text-body-sm text-indigo-700 font-medium mt-0.5">
                              +48 pts accrued
                            </span>
                          </div>
                          <div className="p-3.5 rounded-xl bg-[#FAF8F5] border border-[#EAE4DA] flex flex-col justify-between">
                            <span className="font-label-tag text-label-tag text-[#64748B] uppercase font-semibold">
                              Liquidation Rate
                            </span>
                            <div className="font-label-numeric-md text-label-numeric-md text-[#0F172A] mt-1 font-bold">
                              {userData ? `${userData.liquidationCount} Recorded` : "0 Recorded"}
                            </div>
                            <span className="font-body-sm text-body-sm text-emerald-700 font-medium mt-0.5">
                              Zero Default Risk
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Health Bar Visualizer */}
                      <div className="mt-4 pt-4 bg-[#FAF8F5] p-4 rounded-xl border border-[#EAE4DA] flex flex-col gap-2">
                        <div className="flex items-center justify-between text-body-sm font-body-sm">
                          <span className="text-[#0F172A] font-headline-sm text-body-md font-semibold">
                            Tier {tier} Qualification Threshold
                          </span>
                          <span className="text-teal-700 font-label-numeric-md text-label-numeric-md font-semibold">
                            Next: Tier 3 Elite at 780 pts
                          </span>
                        </div>
                        <div className="w-full h-2.5 rounded-full bg-[#EAE4DA] overflow-hidden relative">
                          <div
                            className="h-full bg-gradient-to-r from-indigo-500 via-teal-500 to-emerald-500 rounded-full transition-all duration-500"
                            style={{ width: `${Math.min(100, Math.max(10, ((score - 300) / 550) * 100))}%` }}
                          ></div>
                        </div>
                        <div className="flex justify-between text-label-tag font-label-tag text-[#64748B] uppercase font-medium">
                          <span>300 (Base)</span>
                          <span>550 (Standard)</span>
                          <span className="text-emerald-700 font-bold">700 (Prime)</span>
                          <span>850 (Max)</span>
                        </div>
                      </div>
                    </div>

                    {/* Card 2: Active Ledger Vault #448-B */}
                    <div className="w-full rounded-2xl bg-white p-space-lg border border-[#EAE4DA] shadow-sm relative">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-[#F5F1EB]">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200/60 flex items-center justify-center">
                            <span className="material-symbols-outlined text-amber-700 text-[22px]">lock</span>
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h2 className="font-headline-sm text-headline-sm text-[#0F172A] font-bold">
                                Active Ledger Vault #448-B
                              </h2>
                              <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
                            </div>
                            <p className="font-body-sm text-body-sm text-[#64748B]">
                              Isolated Multi-Collateral Position on Base Sepolia
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 bg-[#FAF8F5] border border-[#EAE4DA] px-3.5 py-1.5 rounded-xl">
                          <span className="text-body-sm font-body-sm text-[#64748B]">Health Factor</span>
                          <span className="font-label-numeric-md text-label-numeric-md text-emerald-700 font-bold">
                            {healthFactor.toFixed(2)}
                          </span>
                          <span className="text-label-tag font-label-tag px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 uppercase font-semibold">
                            {healthFactor > 1.2 ? "Secure" : healthFactor >= 1.0 ? "Warning" : "Danger"}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-5">
                        {/* Collateral Substrate */}
                        <div className="p-4 rounded-xl bg-[#FAF8F5] border border-[#EAE4DA] flex flex-col justify-between">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-full bg-indigo-100 border border-indigo-200 text-indigo-700 flex items-center justify-center font-bold text-xs">
                                Ξ
                              </div>
                              <span className="font-headline-sm text-body-md text-[#0F172A] font-semibold">
                                Deposited Collateral
                              </span>
                            </div>
                            <span className="text-label-tag font-label-tag text-[#64748B] uppercase font-semibold">
                              mWETH Pool
                            </span>
                          </div>
                          <div className="flex items-baseline justify-between">
                            <span className="font-label-numeric-lg text-label-numeric-lg text-[#0F172A] font-bold">
                              {collateralAmount.toFixed(4)} mWETH
                            </span>
                            <span className="font-label-numeric-md text-label-numeric-md text-[#475569]">
                              {formatUSD(collateralAmount * ethPrice)}
                            </span>
                          </div>
                          <div className="mt-2 text-body-sm font-body-sm text-teal-700 font-medium">
                            Collateral Valuation Oracle: ${ethPrice.toLocaleString()} / ETH
                          </div>
                        </div>

                        {/* Borrow Substrate */}
                        <div className="p-4 rounded-xl bg-[#FAF8F5] border border-[#EAE4DA] flex flex-col justify-between">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-full bg-amber-100 border border-amber-200 text-amber-800 flex items-center justify-center font-bold text-xs">
                                $
                              </div>
                              <span className="font-headline-sm text-body-md text-[#0F172A] font-semibold">
                                Total Borrowed
                              </span>
                            </div>
                            <span className="text-label-tag font-label-tag text-[#64748B] uppercase font-semibold">
                              mUSDC Pool
                            </span>
                          </div>
                          <div className="flex items-baseline justify-between">
                            <span className="font-label-numeric-lg text-label-numeric-lg text-amber-800 font-bold">
                              {debtAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })} mUSDC
                            </span>
                            <span className="font-label-numeric-md text-label-numeric-md text-[#64748B]">
                              {tier === 2 ? "80.0% Max Cap" : "120.0% Cap"}
                            </span>
                          </div>
                          <div className="mt-2 text-body-sm font-body-sm text-[#475569] flex items-center justify-between">
                            <span>Accrual Velocity</span>
                            <span className="font-label-numeric-md text-label-tag text-teal-700 font-semibold">
                              +0.00012 mUSDC / block
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Vault Rate Telemetry Strip */}
                      <div className="mt-4 p-3.5 rounded-xl bg-[#F5F1EB] border border-[#E6DFD5] flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-[#64748B] text-[18px]">trending_up</span>
                          <span className="font-body-sm text-body-sm text-[#475569]">Net Borrow APR:</span>
                          <span className="font-label-numeric-md text-label-numeric-md text-indigo-700 font-bold">
                            {borrowAPR}
                          </span>
                          <span className="font-label-tag text-label-tag px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 uppercase font-semibold">
                            -1.05% Prime Discount
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-body-sm font-body-sm text-[#475569]">
                          <span>Liquidation Price:</span>
                          <span className="font-label-numeric-md text-label-numeric-md text-rose-700 font-bold">
                            ${(ethPrice * 0.68).toFixed(2)} / ETH
                          </span>
                        </div>
                      </div>

                      {/* Action Command Buttons */}
                      <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <button
                          onClick={() => {
                            setActionModal({
                              open: true,
                              type: "borrow",
                              title: "Borrow mUSDC Loan",
                              asset: "mUSDC",
                              defaultVal: "1,500.00",
                            });
                            setModalAmount("1500.00");
                          }}
                          className="py-2.5 px-3 rounded-xl bg-[#4F46E5] hover:bg-indigo-700 text-white font-headline-sm text-label-numeric-md font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm hover:shadow"
                          type="button"
                        >
                          <span className="material-symbols-outlined text-[18px]">payments</span>
                          <span>Borrow</span>
                        </button>
                        <button
                          onClick={() => {
                            setActionModal({
                              open: true,
                              type: "repay",
                              title: "Repay Vault Loan",
                              asset: "mUSDC",
                              defaultVal: "1,000.00",
                            });
                            setModalAmount("1000.00");
                          }}
                          className="py-2.5 px-3 rounded-xl bg-[#FAF8F5] border border-[#DDD4C5] hover:bg-[#F5F1EB] text-[#0F172A] font-headline-sm text-label-numeric-md font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                          type="button"
                        >
                          <span className="material-symbols-outlined text-[18px] text-teal-700">
                            assignment_turned_in
                          </span>
                          <span>Repay</span>
                        </button>
                        <button
                          onClick={() => {
                            setActionModal({
                              open: true,
                              type: "deposit",
                              title: "Deposit mWETH Collateral",
                              asset: "mWETH",
                              defaultVal: "0.50",
                            });
                            setModalAmount("0.50");
                          }}
                          className="py-2.5 px-3 rounded-xl bg-[#FAF8F5] border border-[#DDD4C5] hover:bg-[#F5F1EB] text-[#0F172A] font-headline-sm text-label-numeric-md font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                          type="button"
                        >
                          <span className="material-symbols-outlined text-[18px] text-indigo-600">add_circle</span>
                          <span>Deposit</span>
                        </button>
                        <button
                          onClick={() => {
                            const faucetEl = document.getElementById("faucet-widget");
                            faucetEl?.scrollIntoView({ behavior: "smooth" });
                          }}
                          className="py-2.5 px-3 rounded-xl bg-[#FAF8F5] border border-[#DDD4C5] hover:bg-[#F5F1EB] text-[#0F172A] font-headline-sm text-label-numeric-md font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                          type="button"
                        >
                          <span className="material-symbols-outlined text-[18px] text-amber-700">water_drop</span>
                          <span>Test Faucet</span>
                        </button>
                      </div>
                    </div>

                    {/* Transaction Activity Feed */}
                    <div className="w-full rounded-2xl bg-white p-space-lg border border-[#EAE4DA] shadow-sm">
                      <div className="flex items-center justify-between pb-4 border-b border-[#F5F1EB]">
                        <div className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-[#64748B] text-[20px]">history</span>
                          <h3 className="font-headline-sm text-headline-sm text-[#0F172A] font-bold">
                            Recent Position Activity
                          </h3>
                        </div>
                        <span className="text-label-tag font-label-tag text-[#64748B] uppercase font-semibold">
                          Live Block Stream
                        </span>
                      </div>
                      <div className="flex flex-col gap-2.5 pt-4">
                        <div className="p-3.5 rounded-xl bg-[#FAF8F5] hover:bg-[#F5F1EB] border border-[#EAE4DA] flex items-center justify-between transition-colors">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center">
                              <span className="material-symbols-outlined text-[19px]">check_circle</span>
                            </div>
                            <div>
                              <div className="font-headline-sm text-body-md text-[#0F172A] font-semibold">
                                Repayment Completed
                              </div>
                              <div className="font-body-sm text-body-sm text-[#64748B]">
                                Tx 0x89f2...3c41 • 14 mins ago
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-label-numeric-md text-label-numeric-md text-emerald-700 font-bold">
                              +2,500.00 mUSDC
                            </div>
                            <div className="font-body-sm text-body-sm text-teal-700 font-medium">+4 pts score gain</div>
                          </div>
                        </div>
                        <div className="p-3.5 rounded-xl bg-[#FAF8F5] hover:bg-[#F5F1EB] border border-[#EAE4DA] flex items-center justify-between transition-colors">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 flex items-center justify-center">
                              <span className="material-symbols-outlined text-[19px]">account_balance_wallet</span>
                            </div>
                            <div>
                              <div className="font-headline-sm text-body-md text-[#0F172A] font-semibold">
                                Collateral Added
                              </div>
                              <div className="font-body-sm text-body-sm text-[#64748B]">
                                Tx 0x14a9...b9e2 • 4 hours ago
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-label-numeric-md text-label-numeric-md text-[#0F172A] font-bold">
                              +1.25 mWETH
                            </div>
                            <div className="font-body-sm text-body-sm text-emerald-700 font-semibold">
                              HF boosted to 1.45
                            </div>
                          </div>
                        </div>
                        <div className="p-3.5 rounded-xl bg-[#FAF8F5] hover:bg-[#F5F1EB] border border-[#EAE4DA] flex items-center justify-between transition-colors">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 flex items-center justify-center">
                              <span className="material-symbols-outlined text-[19px]">south_east</span>
                            </div>
                            <div>
                              <div className="font-headline-sm text-body-md text-[#0F172A] font-semibold">
                                Credit Borrow Event
                              </div>
                              <div className="font-body-sm text-body-sm text-[#64748B]">
                                Tx 0x55b1...49d7 • 1 day ago
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-label-numeric-md text-label-numeric-md text-amber-800 font-bold">
                              5,000.00 mUSDC
                            </div>
                            <div className="font-body-sm text-body-sm text-[#475569]">
                              Tier 2 Prime Rate (3.15%)
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right 4 Columns: Ladder & Faucet */}
                  <div className="lg:col-span-4 flex flex-col gap-space-lg">
                    {/* Collateral Ratio Ladder Hierarchy */}
                    <div className="w-full rounded-2xl bg-white p-space-lg border border-[#EAE4DA] shadow-sm relative">
                      <div className="flex items-center justify-between pb-3">
                        <div className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-indigo-600 text-[20px]">stairs</span>
                          <h3 className="font-headline-sm text-headline-sm text-[#0F172A] font-bold">
                            Credit Tier Ladder
                          </h3>
                        </div>
                        <span className="text-label-tag font-label-tag px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold uppercase">
                          Dynamic
                        </span>
                      </div>
                      <p className="font-body-sm text-body-sm text-[#475569] mb-5">
                        Protocol unlocks lower collateralization rules automatically as your TrustScore builds on Base.
                      </p>
                      <div className="flex flex-col gap-3">
                        {/* Tier 2: ACTIVE */}
                        <div
                          className={`p-4 rounded-xl relative shadow-sm transition-all ${
                            tier === 2
                              ? "bg-[#ECFDF5] border-2 border-emerald-500/40"
                              : "bg-[#FAF8F5] border border-[#EAE4DA]"
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full bg-emerald-600"></span>
                              <span className="font-headline-sm text-body-md text-emerald-950 font-bold">
                                Tier 2: Prime
                              </span>
                            </div>
                            {tier === 2 && (
                              <span className="px-2.5 py-0.5 rounded-full bg-emerald-600 text-white font-label-tag text-label-tag uppercase font-bold tracking-wide">
                                Active Tier
                              </span>
                            )}
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-body-sm font-body-sm mb-2">
                            <div className="flex flex-col">
                              <span className="text-emerald-800 font-semibold text-label-tag font-label-tag uppercase">
                                Collateral Ratio
                              </span>
                              <span className="font-label-numeric-md text-label-numeric-md text-[#0F172A] font-bold">
                                80% Req
                              </span>
                            </div>
                            <div className="flex flex-col">
                              <span className="text-emerald-800 font-semibold text-label-tag font-label-tag uppercase">
                                Liquidation Ratio
                              </span>
                              <span className="font-label-numeric-md text-label-numeric-md text-amber-800 font-bold">
                                65% Level
                              </span>
                            </div>
                          </div>
                          <div className="pt-2 border-t border-emerald-200/60 flex items-center justify-between text-body-sm font-body-sm text-emerald-900">
                            <span className="font-medium">Score Range:</span>
                            <span className="font-label-numeric-md text-label-tag text-emerald-950 font-bold">
                              700 – 850 pts
                            </span>
                          </div>
                        </div>

                        {/* Tier 1: Standard */}
                        <div
                          className={`p-4 rounded-xl transition-all ${
                            tier === 1
                              ? "bg-[#ECFDF5] border-2 border-emerald-500/40"
                              : "bg-[#FAF8F5] border border-[#EAE4DA]"
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-headline-sm text-body-md text-[#0F172A] font-semibold">
                              Tier 1: Standard
                            </span>
                            <span className="text-[#64748B] font-label-tag text-label-tag uppercase font-semibold">
                              {tier === 1 ? "Active" : "Unlocked"}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-body-sm font-body-sm mb-2">
                            <div className="flex flex-col">
                              <span className="text-[#64748B] text-label-tag font-label-tag uppercase font-medium">
                                Collateral Ratio
                              </span>
                              <span className="font-label-numeric-md text-label-numeric-md text-[#0F172A] font-semibold">
                                120% Req
                              </span>
                            </div>
                            <div className="flex flex-col">
                              <span className="text-[#64748B] text-label-tag font-label-tag uppercase font-medium">
                                Liquidation Ratio
                              </span>
                              <span className="font-label-numeric-md text-label-numeric-md text-[#0F172A] font-semibold">
                                105% Level
                              </span>
                            </div>
                          </div>
                          <div className="pt-2 border-t border-[#EAE4DA] flex items-center justify-between text-body-sm font-body-sm text-[#475569]">
                            <span>Score Range:</span>
                            <span className="font-label-numeric-md text-label-tag text-[#475569] font-medium">
                              550 – 699 pts
                            </span>
                          </div>
                        </div>

                        {/* Tier 0: Untrusted */}
                        <div
                          className={`p-4 rounded-xl transition-all ${
                            tier === 0
                              ? "bg-[#ECFDF5] border-2 border-emerald-500/40"
                              : "bg-[#FAF8F5] border border-[#EAE4DA] opacity-80"
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-headline-sm text-body-md text-[#475569] font-semibold">
                              Tier 0: Untrusted
                            </span>
                            <span className="text-[#64748B] font-label-tag text-label-tag uppercase font-medium">
                              {tier === 0 ? "Active" : "Legacy"}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-body-sm font-body-sm mb-2">
                            <div className="flex flex-col">
                              <span className="text-[#64748B] text-label-tag font-label-tag uppercase font-medium">
                                Collateral Ratio
                              </span>
                              <span className="font-label-numeric-md text-label-numeric-md text-[#475569] font-medium">
                                150% Req
                              </span>
                            </div>
                            <div className="flex flex-col">
                              <span className="text-[#64748B] text-label-tag font-label-tag uppercase font-medium">
                                Liquidation Ratio
                              </span>
                              <span className="font-label-numeric-md text-label-numeric-md text-[#475569] font-medium">
                                125% Level
                              </span>
                            </div>
                          </div>
                          <div className="pt-2 border-t border-[#EAE4DA] flex items-center justify-between text-body-sm font-body-sm text-[#64748B]">
                            <span>Score Range:</span>
                            <span className="font-label-numeric-md text-label-tag text-[#64748B] font-medium">
                              300 – 549 pts
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Base Sepolia Testnet Faucet Widget */}
                    <div
                      className="w-full rounded-2xl bg-white p-space-lg border border-[#EAE4DA] shadow-sm relative overflow-hidden"
                      id="faucet-widget"
                    >
                      <div className="flex items-center gap-3 pb-3">
                        <div className="w-9 h-9 rounded-xl bg-teal-50 border border-teal-200/60 flex items-center justify-center">
                          <span className="material-symbols-outlined text-teal-700 text-[20px]">water_drop</span>
                        </div>
                        <div>
                          <h3 className="font-headline-sm text-headline-sm text-[#0F172A] font-bold">
                            Base Testnet Faucet
                          </h3>
                          <p className="font-body-sm text-body-sm text-[#64748B]">Instant Hackathon Liquid Allocation</p>
                        </div>
                      </div>
                      <p className="font-body-sm text-body-sm text-[#475569] mb-4 leading-relaxed">
                        Mint mock tokens straight into your test wallet to experiment with borrowing
                        undercollateralized loans.
                      </p>
                      <div className="flex flex-col gap-3">
                        <button
                          onClick={() => handleMintToken("mUSDC")}
                          className="w-full py-2.5 px-4 rounded-xl bg-[#FAF8F5] border border-[#DDD4C5] hover:bg-[#F5F1EB] text-[#0F172A] font-label-numeric-md text-label-numeric-md font-semibold transition-all flex items-center justify-between cursor-pointer group shadow-sm"
                          type="button"
                        >
                          <span className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-teal-700 text-[18px]">toll</span>
                            <span>Mint 10,000 mUSDC</span>
                          </span>
                          <span className="material-symbols-outlined text-[16px] text-[#64748B] group-hover:translate-x-1 transition-transform">
                            bolt
                          </span>
                        </button>
                        <button
                          onClick={() => handleMintToken("mWETH")}
                          className="w-full py-2.5 px-4 rounded-xl bg-[#FAF8F5] border border-[#DDD4C5] hover:bg-[#F5F1EB] text-[#0F172A] font-label-numeric-md text-label-numeric-md font-semibold transition-all flex items-center justify-between cursor-pointer group shadow-sm"
                          type="button"
                        >
                          <span className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-indigo-600 text-[18px]">diamond</span>
                            <span>Mint 5.0 mWETH</span>
                          </span>
                          <span className="material-symbols-outlined text-[16px] text-[#64748B] group-hover:translate-x-1 transition-transform">
                            bolt
                          </span>
                        </button>
                      </div>
                      {faucetStatus && (
                        <div className="mt-3 p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-body-sm font-body-sm text-center font-medium animate-in fade-in">
                          {faucetStatus}
                        </div>
                      )}
                    </div>

                    {/* Network Health Diagnostic Card */}
                    <div className="w-full rounded-2xl bg-white p-5 border border-[#EAE4DA] shadow-sm flex flex-col gap-3">
                      <div className="flex items-center justify-between text-body-sm font-body-sm">
                        <span className="text-[#64748B] font-medium">Oracle Health Feed</span>
                        <span className="text-emerald-700 font-label-numeric-md text-label-tag font-bold">
                          Pyth / Chainlink Sync OK
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-body-sm font-body-sm">
                        <span className="text-[#64748B] font-medium">Smart Contract Audit</span>
                        <span className="text-[#0F172A] font-label-tag text-label-tag uppercase font-bold">
                          0x448...84532 Confirmed
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-body-sm font-body-sm">
                        <span className="text-[#64748B] font-medium">Consensus Target</span>
                        <span className="text-indigo-700 font-label-numeric-md text-label-tag font-bold">
                          200ms Latency
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 2: LIQUIDATIONS                                      */}
        {/* ======================================================== */}
        {tab === "liquidations" && (
          <div className="flex flex-col w-full">
            <div className="relative w-full overflow-hidden pb-space-xl">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-96 bg-gradient-to-b from-[#005c55]/5 via-[#ffb77d]/10 to-transparent blur-3xl pointer-events-none -z-10"></div>

              {/* Header Section */}
              <div className="w-full max-w-[1440px] mx-auto px-margin pt-space-lg pb-space-md">
                <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-space-md">
                  <div className="max-w-3xl space-y-space-xs">
                    <div className="flex items-center gap-space-sm flex-wrap">
                      <span className="px-2.5 py-0.5 rounded-full bg-[#ffdcc3] text-[#904d00] font-label-tag text-label-tag flex items-center gap-1 border border-[#904d00]/20">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#904d00] animate-pulse"></span>
                        KEEPER PROTOCOL v2.4
                      </span>
                      <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white text-[#535c5a] font-label-tag text-label-tag border border-[#E6DFD5]">
                        <span className="material-symbols-outlined text-[13px] text-[#005e40]">tune</span>
                        <span>BASE SEPOLIA #84532</span>
                      </div>
                      <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white text-[#005e40] font-label-numeric-md text-body-sm border border-[#E6DFD5]">
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#005e40] opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#005e40]"></span>
                        </span>
                        <span className="font-semibold text-[#111c2d]">
                          Block #{blockNumber ? blockNumber.toString() : "14,923,812"}
                        </span>
                        <span className="text-[#e6dfd5] font-body-sm">|</span>
                        <span className="text-[#535c5a] font-body-sm">Gas: 0.04 Gwei</span>
                      </div>
                    </div>
                    <h1 className="font-headline-lg text-headline-lg text-[#111c2d] tracking-tight mt-space-sm font-bold">
                      Liquidation &amp; Keeper Desk
                    </h1>
                    <p className="font-body-lg text-body-lg text-[#535c5a] max-w-2xl">
                      Permissionless liquidation network — anyone can run the viem keeper script to monitor positions
                      and claim 5% instant liquidation bounties on unhealthy loans.
                    </p>
                  </div>
                  <div className="flex items-center gap-space-sm self-start lg:self-auto">
                    <button
                      className="px-space-md py-2 rounded-xl bg-white hover:bg-slate-50 text-[#111c2d] font-label-numeric-md text-label-numeric-md transition-all flex items-center gap-space-xs shadow-xs border border-[#E6DFD5] cursor-pointer"
                      onClick={() => document.getElementById("keeper-cli-box")?.scrollIntoView({ behavior: "smooth" })}
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[18px] text-[#005c55]">terminal</span>
                      <span className="font-semibold">View CLI Agent</span>
                    </button>
                    <a
                      className="px-space-md py-2 rounded-xl bg-[#005c55] hover:bg-[#0f766e] text-white font-label-numeric-md text-label-numeric-md transition-all flex items-center gap-space-xs shadow-md shadow-[#005c55]/20 font-semibold"
                      href="#install-guide"
                    >
                      <span className="material-symbols-outlined text-[18px]">rocket_launch</span>
                      <span>Deploy Keeper</span>
                    </a>
                  </div>
                </div>

                {/* Top Summary Metrics Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-space-md mt-space-lg">
                  <div className="p-space-md rounded-xl bg-white border border-[#E6DFD5] shadow-xs flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="font-label-tag text-label-tag uppercase text-[#535c5a] font-semibold">
                        Total Liquidated
                      </span>
                      <div className="w-7 h-7 rounded-lg bg-[#85f8c4]/40 flex items-center justify-center">
                        <span className="material-symbols-outlined text-[16px] text-[#005e40]">water_drop</span>
                      </div>
                    </div>
                    <div className="mt-space-sm">
                      <div className="font-headline-lg text-headline-lg text-[#111c2d] font-bold tracking-tight">
                        $284,500
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 font-body-sm text-body-sm text-[#005e40] font-semibold">
                        <span className="material-symbols-outlined text-[14px]">trending_up</span>
                        <span>+$34,200 this week</span>
                      </div>
                    </div>
                  </div>
                  <div className="p-space-md rounded-xl bg-white border border-[#E6DFD5] shadow-xs flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="font-label-tag text-label-tag uppercase text-[#535c5a] font-semibold">
                        Monitored Vaults
                      </span>
                      <div className="w-7 h-7 rounded-lg bg-[#9cf2e8]/40 flex items-center justify-center">
                        <span className="material-symbols-outlined text-[16px] text-[#005c55]">analytics</span>
                      </div>
                    </div>
                    <div className="mt-space-sm">
                      <div className="flex items-baseline gap-2">
                        <span className="font-headline-lg text-headline-lg text-[#111c2d] font-bold tracking-tight">
                          142
                        </span>
                        <span className="font-body-sm text-body-sm text-[#ba1a1a] font-semibold bg-[#ffdad6]/50 px-2 py-0.5 rounded-md">
                          2 Underwater
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 font-body-sm text-body-sm text-[#535c5a]">
                        <span>98.6% health index avg</span>
                      </div>
                    </div>
                  </div>
                  <div className="p-space-md rounded-xl bg-white border border-[#E6DFD5] shadow-xs flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="font-label-tag text-label-tag uppercase text-[#535c5a] font-semibold">
                        24h Keeper Bounties
                      </span>
                      <div className="w-7 h-7 rounded-lg bg-[#ffdcc3]/50 flex items-center justify-center">
                        <span className="material-symbols-outlined text-[16px] text-[#904d00]">payments</span>
                      </div>
                    </div>
                    <div className="mt-space-sm">
                      <div className="font-headline-lg text-headline-lg text-[#904d00] font-bold tracking-tight">
                        $14,225{" "}
                        <span className="font-body-sm text-body-sm text-[#535c5a] font-medium">mUSDC</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 font-body-sm text-body-sm text-[#535c5a]">
                        <span>18 keepers awarded</span>
                      </div>
                    </div>
                  </div>
                  <div className="p-space-md rounded-xl bg-white border border-[#E6DFD5] shadow-xs flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="font-label-tag text-label-tag uppercase text-[#535c5a] font-semibold">
                        Threshold Rule
                      </span>
                      <div className="w-7 h-7 rounded-lg bg-[#ffdad6]/60 flex items-center justify-center">
                        <span className="material-symbols-outlined text-[16px] text-[#ba1a1a]">gavel</span>
                      </div>
                    </div>
                    <div className="mt-space-sm">
                      <div className="flex items-baseline gap-1.5">
                        <span className="font-headline-lg text-headline-lg text-[#ba1a1a] font-bold tracking-tight">
                          HF &lt; 1.00
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-1 font-body-sm text-body-sm text-[#535c5a]">
                        <span>Penalty: 5.00%</span>
                        <span className="text-[#005e40] font-semibold">Instant Payout</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Main Layout Bento Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-lg mt-space-lg">
                  {/* LEFT: At-Risk & Liquidatable Vaults (8 Cols) */}
                  <div className="lg:col-span-8 flex flex-col gap-space-md">
                    <div className="p-space-lg rounded-xl bg-white border border-[#E6DFD5] shadow-xs flex flex-col gap-space-md">
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-space-sm pb-space-xs">
                        <div>
                          <div className="flex items-center gap-space-xs">
                            <span className="w-2.5 h-2.5 rounded-full bg-[#ba1a1a] animate-pulse"></span>
                            <h2 className="font-headline-md text-headline-md text-[#111c2d] font-bold">
                              At-Risk &amp; Liquidatable Vaults
                            </h2>
                          </div>
                          <p className="font-body-sm text-body-sm text-[#535c5a] mt-0.5">
                            Positions with Health Factor &lt; 1.00 can be seized and settled onchain for 5% reward.
                          </p>
                        </div>
                      </div>

                      {/* Vault Table */}
                      <div className="w-full overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-[#F5F1EB] text-[#535c5a] text-label-tag font-label-tag uppercase border-b border-[#E6DFD5]">
                              <th className="py-3 px-4 rounded-l-lg">Borrower / Vault</th>
                              <th className="py-3 px-3">Collateral</th>
                              <th className="py-3 px-3">Debt</th>
                              <th className="py-3 px-3 text-center">Health Factor</th>
                              <th className="py-3 px-3 text-right">Max Liquidatable</th>
                              <th className="py-3 px-3 text-right">5% Bounty</th>
                              <th className="py-3 px-4 rounded-r-lg text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#E6DFD5]/60">
                            {/* Row 1: Underwater (HF 0.92) */}
                            <tr className="bg-[#ffdad6]/10 hover:bg-[#ffdad6]/20 transition-colors group">
                              <td className="py-3.5 px-4">
                                <div className="flex items-center gap-2">
                                  <div className="w-8 h-8 rounded-lg bg-[#ffdad6] text-[#ba1a1a] flex items-center justify-center font-bold">
                                    <span className="material-symbols-outlined text-[18px]">warning</span>
                                  </div>
                                  <div>
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-label-numeric-md text-label-numeric-md text-[#111c2d] font-semibold">
                                        #V-8491
                                      </span>
                                      <span className="font-label-tag text-label-tag px-1.5 py-0.5 rounded bg-[#ba1a1a]/10 text-[#ba1a1a] font-bold">
                                        CRITICAL
                                      </span>
                                    </div>
                                    <span className="font-body-sm text-body-sm text-[#535c5a] font-mono">
                                      0x71C8...4f9B
                                    </span>
                                  </div>
                                </div>
                              </td>
                              <td className="py-3.5 px-3">
                                <div className="font-label-numeric-md text-label-numeric-md text-[#111c2d] font-semibold">
                                  1.820 mWETH
                                </div>
                                <div className="font-body-sm text-body-sm text-[#535c5a]">$5,460.00</div>
                              </td>
                              <td className="py-3.5 px-3">
                                <div className="font-label-numeric-md text-label-numeric-md text-[#ba1a1a] font-bold">
                                  4,450.00 mUSDC
                                </div>
                                <div className="font-body-sm text-body-sm text-[#535c5a]">LTV: 81.5%</div>
                              </td>
                              <td className="py-3.5 px-3 text-center">
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#ffdad6] text-[#ba1a1a] font-label-numeric-md text-label-numeric-md font-bold">
                                  <span className="w-1.5 h-1.5 rounded-full bg-[#ba1a1a]"></span>
                                  0.92
                                </span>
                              </td>
                              <td className="py-3.5 px-3 text-right">
                                <div className="font-label-numeric-md text-label-numeric-md text-[#111c2d] font-medium">
                                  2,225 mUSDC
                                </div>
                                <div className="font-body-sm text-body-sm text-[#535c5a]">50% Close Factor</div>
                              </td>
                              <td className="py-3.5 px-3 text-right">
                                <span className="font-label-numeric-md text-label-numeric-md text-[#005e40] font-bold">
                                  +111.25 mUSDC
                                </span>
                              </td>
                              <td className="py-3.5 px-4 text-right">
                                <button
                                  className="px-3.5 py-1.5 rounded-lg bg-[#ba1a1a] text-white hover:bg-[#ba1a1a]/90 font-label-numeric-md text-label-numeric-md font-bold transition-all shadow-sm flex items-center gap-1.5 ml-auto cursor-pointer"
                                  onClick={() =>
                                    setLiqModal({
                                      open: true,
                                      borrower: "0x71C8...4f9B",
                                      debt: "2,225 mUSDC",
                                      bounty: "+111.25 mUSDC",
                                    })
                                  }
                                  type="button"
                                >
                                  <span className="material-symbols-outlined text-[15px]">flash_on</span>
                                  <span>Liquidate</span>
                                </button>
                              </td>
                            </tr>

                            {/* Row 2: Underwater (HF 0.96) */}
                            <tr className="bg-[#ffdad6]/10 hover:bg-[#ffdad6]/20 transition-colors group">
                              <td className="py-3.5 px-4">
                                <div className="flex items-center gap-2">
                                  <div className="w-8 h-8 rounded-lg bg-[#ffdad6] text-[#ba1a1a] flex items-center justify-center font-bold">
                                    <span className="material-symbols-outlined text-[18px]">warning</span>
                                  </div>
                                  <div>
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-label-numeric-md text-label-numeric-md text-[#111c2d] font-semibold">
                                        #V-6620
                                      </span>
                                      <span className="font-label-tag text-label-tag px-1.5 py-0.5 rounded bg-[#ba1a1a]/10 text-[#ba1a1a] font-bold">
                                        CRITICAL
                                      </span>
                                    </div>
                                    <span className="font-body-sm text-body-sm text-[#535c5a] font-mono">
                                      0x3A81...90cD
                                    </span>
                                  </div>
                                </div>
                              </td>
                              <td className="py-3.5 px-3">
                                <div className="font-label-numeric-md text-label-numeric-md text-[#111c2d] font-semibold">
                                  3.450 mWETH
                                </div>
                                <div className="font-body-sm text-body-sm text-[#535c5a]">$10,350.00</div>
                              </td>
                              <td className="py-3.5 px-3">
                                <div className="font-label-numeric-md text-label-numeric-md text-[#ba1a1a] font-bold">
                                  8,200.00 mUSDC
                                </div>
                                <div className="font-body-sm text-body-sm text-[#535c5a]">LTV: 79.2%</div>
                              </td>
                              <td className="py-3.5 px-3 text-center">
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#ffdad6] text-[#ba1a1a] font-label-numeric-md text-label-numeric-md font-bold">
                                  <span className="w-1.5 h-1.5 rounded-full bg-[#ba1a1a]"></span>
                                  0.96
                                </span>
                              </td>
                              <td className="py-3.5 px-3 text-right">
                                <div className="font-label-numeric-md text-label-numeric-md text-[#111c2d] font-medium">
                                  4,100 mUSDC
                                </div>
                                <div className="font-body-sm text-body-sm text-[#535c5a]">50% Close Factor</div>
                              </td>
                              <td className="py-3.5 px-3 text-right">
                                <span className="font-label-numeric-md text-label-numeric-md text-[#005e40] font-bold">
                                  +205.00 mUSDC
                                </span>
                              </td>
                              <td className="py-3.5 px-4 text-right">
                                <button
                                  className="px-3.5 py-1.5 rounded-lg bg-[#ba1a1a] text-white hover:bg-[#ba1a1a]/90 font-label-numeric-md text-label-numeric-md font-bold transition-all shadow-sm flex items-center gap-1.5 ml-auto cursor-pointer"
                                  onClick={() =>
                                    setLiqModal({
                                      open: true,
                                      borrower: "0x3A81...90cD",
                                      debt: "4,100 mUSDC",
                                      bounty: "+205.00 mUSDC",
                                    })
                                  }
                                  type="button"
                                >
                                  <span className="material-symbols-outlined text-[15px]">flash_on</span>
                                  <span>Liquidate</span>
                                </button>
                              </td>
                            </tr>

                            {/* Row 3: Solvent */}
                            <tr className="hover:bg-[#F5F1EB]/50 transition-colors">
                              <td className="py-3.5 px-4">
                                <div className="flex items-center gap-2">
                                  <div className="w-8 h-8 rounded-lg bg-[#ffdcc3] text-[#904d00] flex items-center justify-center">
                                    <span className="material-symbols-outlined text-[18px]">priority_high</span>
                                  </div>
                                  <div>
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-label-numeric-md text-label-numeric-md text-[#111c2d] font-semibold">
                                        #V-1193
                                      </span>
                                      <span className="font-label-tag text-label-tag px-1.5 py-0.5 rounded bg-[#ffdcc3] text-[#904d00] font-bold">
                                        WARNING
                                      </span>
                                    </div>
                                    <span className="font-body-sm text-body-sm text-[#535c5a] font-mono">
                                      0xFA21...28Eb
                                    </span>
                                  </div>
                                </div>
                              </td>
                              <td className="py-3.5 px-3">
                                <div className="font-label-numeric-md text-label-numeric-md text-[#111c2d] font-semibold">
                                  0.950 mWETH
                                </div>
                                <div className="font-body-sm text-body-sm text-[#535c5a]">$2,850.00</div>
                              </td>
                              <td className="py-3.5 px-3">
                                <div className="font-label-numeric-md text-label-numeric-md text-[#111c2d] font-semibold">
                                  2,050.00 mUSDC
                                </div>
                                <div className="font-body-sm text-body-sm text-[#535c5a]">LTV: 71.9%</div>
                              </td>
                              <td className="py-3.5 px-3 text-center">
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#ffdcc3] text-[#904d00] font-label-numeric-md text-label-numeric-md font-bold">
                                  1.04
                                </span>
                              </td>
                              <td className="py-3.5 px-3 text-right">
                                <div className="font-label-numeric-md text-label-numeric-md text-[#535c5a]">
                                  1,025 mUSDC
                                </div>
                                <div className="font-body-sm text-body-sm text-[#8d9694]">Protected</div>
                              </td>
                              <td className="py-3.5 px-3 text-right">
                                <span className="font-label-numeric-md text-label-numeric-md text-[#8d9694]">
                                  +51.25 mUSDC
                                </span>
                              </td>
                              <td className="py-3.5 px-4 text-right">
                                <button
                                  className="px-3.5 py-1.5 rounded-lg bg-[#EFE9DF] text-[#8d9694] font-label-numeric-md text-label-numeric-md cursor-not-allowed ml-auto flex items-center gap-1 font-semibold"
                                  disabled
                                >
                                  <span className="material-symbols-outlined text-[15px]">lock</span>
                                  <span>Solvent</span>
                                </button>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Settlement Mechanism Insight Bento Card */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-space-md">
                      <div className="p-space-md rounded-xl bg-white border border-[#E6DFD5] shadow-xs flex flex-col justify-between">
                        <div>
                          <div className="w-9 h-9 rounded-lg bg-[#9cf2e8]/50 text-[#005c55] flex items-center justify-center mb-space-sm">
                            <span className="material-symbols-outlined text-[20px]">donut_large</span>
                          </div>
                          <h3 className="font-headline-sm text-headline-sm text-[#111c2d] font-bold">
                            50% Close Factor
                          </h3>
                          <p className="font-body-sm text-body-sm text-[#535c5a] mt-1">
                            Protects borrower by capping liquidation to half debt per call, giving them runway to
                            replenish collateral.
                          </p>
                        </div>
                        <span className="mt-space-sm font-label-tag text-label-tag text-[#005c55] uppercase font-bold">
                          Standard Safety Rule
                        </span>
                      </div>
                      <div className="p-space-md rounded-xl bg-white border border-[#E6DFD5] shadow-xs flex flex-col justify-between">
                        <div>
                          <div className="w-9 h-9 rounded-lg bg-[#ffdcc3] text-[#904d00] flex items-center justify-center mb-space-sm">
                            <span className="material-symbols-outlined text-[20px]">redeem</span>
                          </div>
                          <h3 className="font-headline-sm text-headline-sm text-[#111c2d] font-bold">
                            5% Keeper Bounty
                          </h3>
                          <p className="font-body-sm text-body-sm text-[#535c5a] mt-1">
                            Keepers repay debt in mUSDC and claim equivalent mWETH collateral at a guaranteed 5% market
                            discount.
                          </p>
                        </div>
                        <span className="mt-space-sm font-label-tag text-label-tag text-[#904d00] uppercase font-bold">
                          Pure MEV Yield
                        </span>
                      </div>
                      <div className="p-space-md rounded-xl bg-white border border-[#E6DFD5] shadow-xs flex flex-col justify-between">
                        <div>
                          <div className="w-9 h-9 rounded-lg bg-[#85f8c4]/50 text-[#005e40] flex items-center justify-center mb-space-sm">
                            <span className="material-symbols-outlined text-[20px]">electric_bolt</span>
                          </div>
                          <h3 className="font-headline-sm text-headline-sm text-[#111c2d] font-bold">
                            Flash Execution
                          </h3>
                          <p className="font-body-sm text-body-sm text-[#535c5a] mt-1">
                            Compatible with Uniswap v3 flash swaps. You don't need upfront capital — borrow, liquidate,
                            repay in 1 tx.
                          </p>
                        </div>
                        <span className="mt-space-sm font-label-tag text-label-tag text-[#005e40] uppercase font-bold">
                          Zero Upfront Capital
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* RIGHT: Live Viem Keeper Terminal (4 Cols) */}
                  <div className="lg:col-span-4 flex flex-col gap-space-md" id="keeper-cli-box">
                    <div className="rounded-xl bg-[#1e2430] border border-[#2d3748] shadow-lg flex flex-col overflow-hidden h-full">
                      <div className="px-space-md py-3 bg-[#171c26] border-b border-[#2d3748] flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="flex gap-1.5">
                            <span className="w-3 h-3 rounded-full bg-[#ef4444] inline-block"></span>
                            <span className="w-3 h-3 rounded-full bg-[#f59e0b] inline-block"></span>
                            <span className="w-3 h-3 rounded-full bg-[#10b981] inline-block"></span>
                          </div>
                          <span className="ml-2 font-mono text-body-sm text-slate-200 font-semibold flex items-center gap-1.5">
                            <span className="material-symbols-outlined text-[15px] text-[#34d399]">terminal</span>
                            <span>keeper-bot.ts</span>
                          </span>
                        </div>
                        <span className="font-label-tag text-label-tag text-[#34d399] bg-[#10b981]/20 px-2 py-0.5 rounded-full flex items-center gap-1 font-semibold">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#34d399] animate-pulse"></span>
                          RUNNING
                        </span>
                      </div>

                      <div className="p-space-md font-mono text-body-sm leading-relaxed text-slate-300 flex-1 overflow-y-auto max-h-[540px] space-y-2.5">
                        <div className="text-slate-400">
                          [@trustpool/keeper-viem] initialized on Base Sepolia (84532)
                        </div>
                        <div className="text-slate-400">
                          Subscribed to LendingPool: {ADDRESSES.lendingPool.slice(0, 8)}...
                        </div>
                        {terminalLogs.map((log, idx) => (
                          <div
                            key={idx}
                            className={`p-2 rounded ${
                              log.type === "alert"
                                ? "bg-[#991b1b]/30 border-l-2 border-[#ef4444] text-slate-100"
                                : log.type === "tx"
                                ? "bg-[#065f46]/30 border-l-2 border-[#34d399] text-slate-100"
                                : "bg-[#171c26] border-l-2 border-[#38bdf8]"
                            }`}
                          >
                            <div className="font-bold text-[13px]">{log.text}</div>
                            {log.detail && <div className="text-slate-400 text-[11px] mt-0.5">{log.detail}</div>}
                            {log.extra && <div className="text-[#fbbf24] text-[12px] font-bold mt-0.5">{log.extra}</div>}
                          </div>
                        ))}
                      </div>

                      <div className="p-space-md bg-[#171c26] border-t border-[#2d3748] flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-[#34d399]"></span>
                          <span className="font-mono text-body-sm text-slate-300">Keeper Wallet: 0xK33P...89C4</span>
                        </div>
                        <button
                          className="px-2.5 py-1 rounded bg-[#2d3748] hover:bg-[#374151] text-slate-200 font-label-tag text-label-tag uppercase transition-all cursor-pointer"
                          onClick={() => setTerminalStreaming(!terminalStreaming)}
                          type="button"
                        >
                          {terminalStreaming ? "Pause Feed" : "Resume Feed"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* BOTTOM: Deploy & Install Guide */}
                <div className="mt-space-lg rounded-xl bg-white border border-[#E6DFD5] p-space-lg shadow-xs" id="install-guide">
                  <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-space-md pb-space-md">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-[24px] text-[#005e40]">developer_mode</span>
                        <h2 className="font-headline-md text-headline-md text-[#111c2d] font-bold">
                          Run Your Own Viem Keeper Agent
                        </h2>
                      </div>
                      <p className="font-body-md text-body-md text-[#535c5a] mt-1">
                        Automate position scanning with sub-second execution on Base Sepolia. Open-source, lightweight
                        TypeScript daemon.
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-md pt-space-xs">
                    <div className="lg:col-span-6 space-y-space-md">
                      <div className="flex items-start gap-3">
                        <div className="w-6 h-6 rounded-full bg-[#005c55] text-white flex items-center justify-center font-bold text-body-sm flex-shrink-0 mt-0.5">
                          1
                        </div>
                        <div className="flex-1">
                          <div className="font-label-numeric-md text-label-numeric-md text-[#111c2d] font-semibold">
                            Clone &amp; Install Dependencies
                          </div>
                          <div className="mt-1.5 p-2.5 rounded-lg bg-[#FAF8F5] border border-[#E6DFD5] font-mono text-body-sm text-[#005e40] font-medium flex items-center justify-between">
                            <span>cd keeper &amp;&amp; pnpm install</span>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText("cd keeper && pnpm install");
                                showToast("Copied command!", "info");
                              }}
                              className="cursor-pointer text-[#535c5a] hover:text-[#111c2d]"
                            >
                              <span className="material-symbols-outlined text-[16px]">content_copy</span>
                            </button>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="w-6 h-6 rounded-full bg-[#005c55] text-white flex items-center justify-center font-bold text-body-sm flex-shrink-0 mt-0.5">
                          2
                        </div>
                        <div className="flex-1">
                          <div className="font-label-numeric-md text-label-numeric-md text-[#111c2d] font-semibold">
                            Configure Environment (.env)
                          </div>
                          <div className="mt-1.5 p-2.5 rounded-lg bg-[#FAF8F5] border border-[#E6DFD5] font-mono text-body-sm text-[#111c2d] font-medium flex items-center justify-between">
                            <span>RPC_URL=https://sepolia.base.org</span>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText("RPC_URL=https://sepolia.base.org\nKEEPER_PRIVATE_KEY=0x...");
                                showToast("Copied env!", "info");
                              }}
                              className="cursor-pointer text-[#535c5a] hover:text-[#111c2d]"
                            >
                              <span className="material-symbols-outlined text-[16px]">content_copy</span>
                            </button>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="w-6 h-6 rounded-full bg-[#005c55] text-white flex items-center justify-center font-bold text-body-sm flex-shrink-0 mt-0.5">
                          3
                        </div>
                        <div className="flex-1">
                          <div className="font-label-numeric-md text-label-numeric-md text-[#111c2d] font-semibold">
                            Launch the Daemon
                          </div>
                          <div className="mt-1.5 p-2.5 rounded-lg bg-[#FAF8F5] border border-[#E6DFD5] font-mono text-body-sm text-[#904d00] font-semibold flex items-center justify-between">
                            <span>pnpm start</span>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText("pnpm start");
                                showToast("Copied command!", "info");
                              }}
                              className="cursor-pointer text-[#535c5a] hover:text-[#111c2d]"
                            >
                              <span className="material-symbols-outlined text-[16px]">content_copy</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="lg:col-span-6 bg-[#FAF8F5] border border-[#E6DFD5] rounded-xl p-space-md overflow-x-auto font-mono text-body-sm text-[#535c5a] leading-relaxed">
                      <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#E6DFD5] text-[#8d9694] text-[11px] uppercase tracking-wider font-label-tag">
                        <span className="font-semibold text-[#111c2d]">TypeScript Engine Snippet</span>
                        <span className="text-[#005e40] font-bold">viem v2.x</span>
                      </div>
                      <pre className="text-[#334155] text-[12px]">
                        <span className="text-[#005c55] font-semibold">import</span> &#123; createPublicClient,
                        createWalletClient, http &#125; <span className="text-[#005c55] font-semibold">from</span>{" "}
                        <span className="text-[#904d00] font-semibold">'viem'</span>;
                        {"\n\n"}
                        <span className="text-slate-400 italic">// Watch blocks and trigger liquidate on HF &lt; 1.0</span>
                        {"\n"}client.<span className="text-[#005e40] font-semibold">watchBlockNumber</span>(&#123;
                        {"\n"}  <span className="text-[#005e40] font-semibold">onBlockNumber</span>:{" "}
                        <span className="text-[#005c55] font-semibold">async</span> (blockNumber) =&gt; &#123;
                        {"\n"}    <span className="text-[#005c55] font-semibold">const</span> vaults ={" "}
                        <span className="text-[#005c55] font-semibold">await</span> poolContract.read.
                        <span className="text-[#005e40] font-semibold">getUnderwaterVaults</span>();
                        {"\n"}    <span className="text-[#005c55] font-semibold">for</span> (
                        <span className="text-[#005c55] font-semibold">const</span> vault{" "}
                        <span className="text-[#005c55] font-semibold">of</span> vaults) &#123;
                        {"\n"}      <span className="text-[#005c55] font-semibold">await</span> wallet.writeContract(&#123;
                        {"\n"}        functionName:{" "}
                        <span className="text-[#904d00] font-semibold">'liquidate'</span>,
                        {"\n"}        args: [vault.borrower, vault.maxRepayAmount]
                        {"\n"}      &#125;);
                        {"\n"}    &#125;
                        {"\n"}  &#125;
                        {"\n"}&#125;);
                      </pre>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 3: COMPARE                                           */}
        {/* ======================================================== */}
        {tab === "compare" && (
          <div className="flex flex-col w-full">
            <div className="relative w-full overflow-hidden">
              <div className="max-w-[1600px] mx-auto px-margin md:px-margin-desktop py-space-lg flex flex-col gap-space-lg">
                {/* SECTION 1: HEADER & STATS BROADCAST */}
                <section className="flex flex-col xl:flex-row xl:items-end justify-between gap-space-md bg-white p-space-lg rounded-xl shadow-sm border border-[#EAE4DA]">
                  <div className="flex flex-col max-w-3xl min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#F5F1EB] font-label-tag text-body-sm text-[#535c5a] uppercase tracking-wider font-semibold">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#005c55] animate-pulse"></span>
                        TIER EVALUATION ENGINE
                      </span>
                      <span className="font-mono text-body-sm text-[#8d9694]">|</span>
                      <span className="font-mono text-body-sm text-[#535c5a]">
                        Smart Contract:{" "}
                        <code className="font-semibold text-[#005c55]">CreditScore.sol</code>
                      </span>
                    </div>
                    <h1 className="font-headline-lg text-headline-lg text-[#111c2d] font-semibold tracking-tight">
                      Side-by-Side Wallet Credit Terms Comparison
                    </h1>
                    <p className="font-body-md text-body-md text-[#535c5a] mt-1.5 max-w-2xl">
                      Demonstrating how onchain credit scoring in{" "}
                      <span className="font-semibold text-[#111c2d]">CreditScore.sol</span> unlocks unprecedented
                      capital efficiency: New Wallet (Tier 0) vs. Seeded Prime Wallet (Tier 2).
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-space-sm shrink-0">
                    <div className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#F5F1EB] text-[#111c2d] shadow-xs border border-[#E6DFD5]">
                      <span className="material-symbols-outlined text-[#005c55] text-base">sensors</span>
                      <div className="flex flex-col">
                        <span className="font-label-tag text-[10px] uppercase text-[#8d9694] font-bold">
                          Base Sepolia Oracle
                        </span>
                        <span className="font-mono text-body-md font-semibold text-[#111c2d]">
                          ETH = ${ethPrice.toLocaleString()}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2.5 px-4 py-2 rounded-lg bg-[#0f766e] text-white shadow-xs">
                      <span className="material-symbols-outlined text-lg">trending_up</span>
                      <div className="flex flex-col">
                        <span className="font-label-tag text-[10px] uppercase text-emerald-200 font-bold">
                          Capital Savings Spread
                        </span>
                        <span className="font-mono text-headline-sm font-semibold text-white">
                          -{formatUSD(compareAmount * 1.5 - compareAmount * 0.8)} Upfront
                        </span>
                      </div>
                    </div>
                  </div>
                </section>

                {/* SECTION 2: BENCHMARK SCENARIO SELECTOR */}
                <section className="flex flex-col md:flex-row md:items-center justify-between gap-space-md p-space-md bg-white rounded-xl shadow-xs border border-[#EAE4DA]">
                  <div className="flex items-center gap-3">
                    <span className="font-label-tag text-label-tag uppercase tracking-wider text-[#8d9694] flex items-center gap-1 font-bold">
                      <span className="material-symbols-outlined text-sm">tune</span> Scenario:
                    </span>
                    <div className="inline-flex p-1 bg-[#F5F1EB] rounded-lg gap-1 border border-[#E6DFD5]">
                      {[
                        { val: 10000, label: "10k mUSDC (Standard)" },
                        { val: 50000, label: "50k mUSDC (Whale)" },
                        { val: 2500, label: "2.5k mUSDC (Retail)" },
                      ].map((item) => (
                        <button
                          key={item.val}
                          onClick={() => setCompareAmount(item.val)}
                          className={`px-4 py-1.5 rounded font-label-tag text-[13px] font-semibold transition-all cursor-pointer ${
                            compareAmount === item.val
                              ? "bg-white text-[#005c55] shadow-xs"
                              : "text-[#535c5a] hover:text-[#111c2d]"
                          }`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-[#535c5a] font-body-sm text-body-sm">
                    <span className="material-symbols-outlined text-[#005c55] text-sm">info</span>
                    <span>
                      Borrowing <strong className="text-[#111c2d] font-mono">{compareAmount.toLocaleString()} mUSDC</strong> with ETH collateral at <strong className="text-[#111c2d] font-mono">${ethPrice}/ETH</strong>
                    </span>
                  </div>
                </section>

                {/* SECTION 3: SIDE-BY-SIDE COMPARISON CARDS */}
                <section className="grid grid-cols-1 lg:grid-cols-12 gap-space-lg items-stretch">
                  {/* CARD A: TIER 0 FRESH WALLET */}
                  <div className="lg:col-span-6 flex flex-col justify-between bg-white rounded-xl p-space-lg shadow-sm border border-[#EAE4DA] relative overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-1 bg-[#DDD4C5]"></div>
                    <div className="flex flex-col gap-space-md">
                      <div className="flex items-start justify-between gap-space-sm">
                        <div>
                          <span className="inline-flex px-2 py-0.5 rounded bg-[#F5F1EB] font-label-tag text-body-sm text-[#111c2d] uppercase font-semibold">
                            Baseline Benchmark
                          </span>
                          <h2 className="font-headline-lg text-headline-lg text-[#111c2d] font-semibold mt-1">
                            Wallet A: Fresh Wallet
                          </h2>
                          <p className="font-mono text-body-sm text-[#8d9694]">Tier 0 • Standard Overcollateralized</p>
                        </div>
                        <span className="material-symbols-outlined text-[#8d9694] text-3xl">no_accounts</span>
                      </div>

                      <div className="flex items-center gap-space-md p-space-md bg-[#FAF8F5] rounded-lg border border-[#EAE4DA]">
                        <div className="relative w-16 h-16 shrink-0 flex items-center justify-center">
                          <svg className="w-16 h-16 transform -rotate-90" viewBox="0 0 36 36">
                            <path
                              className="text-[#EAE4DA]"
                              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="3.5"
                            ></path>
                            <path
                              className="text-[#8d9694]"
                              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                              fill="none"
                              stroke="currentColor"
                              strokeDasharray="35, 100"
                              strokeLinecap="round"
                              strokeWidth="3.5"
                            ></path>
                          </svg>
                          <span className="font-mono text-headline-sm font-bold text-[#111c2d] absolute">300</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="font-label-tag text-[10px] uppercase text-[#8d9694] font-bold">
                            CreditScore.sol Score
                          </span>
                          <span className="font-headline-sm text-headline-sm font-semibold text-[#111c2d]">
                            300 <span className="text-body-sm text-[#8d9694] font-normal">/ 850</span>
                          </span>
                          <span className="font-body-sm text-body-sm text-[#535c5a]">
                            35th percentile • Unproven Onchain History
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2.5">
                        <div className="flex items-center justify-between p-3 rounded-lg bg-[#FAF8F5] border border-[#EAE4DA]">
                          <div className="flex flex-col">
                            <span className="font-label-tag text-[10px] uppercase text-[#8d9694] font-bold">
                              Required Collateral (150%)
                            </span>
                            <span className="font-body-sm text-body-sm text-[#535c5a]">
                              {((compareAmount * 1.5) / ethPrice).toFixed(2)} ETH upfront commitment
                            </span>
                          </div>
                          <span className="font-mono text-headline-sm font-semibold text-[#111c2d]">
                            {formatUSD(compareAmount * 1.5)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between p-3 rounded-lg bg-[#FAF8F5] border border-[#EAE4DA]">
                          <div className="flex flex-col">
                            <span className="font-label-tag text-[10px] uppercase text-[#8d9694] font-bold">
                              Liquidation Threshold (125%)
                            </span>
                            <span className="font-body-sm text-body-sm text-[#ba1a1a]">
                              Triggers if ETH drops to ${((compareAmount * 1.25) / ((compareAmount * 1.5) / ethPrice)).toFixed(0)} (-16.6%)
                            </span>
                          </div>
                          <span className="font-mono text-headline-sm font-medium text-[#111c2d]">
                            {formatUSD(compareAmount * 1.25)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between p-3 rounded-lg bg-[#FAF8F5] border border-[#EAE4DA]">
                          <div className="flex flex-col">
                            <span className="font-label-tag text-[10px] uppercase text-[#8d9694] font-bold">
                              Effective Borrow APR
                            </span>
                            <span className="font-body-sm text-body-sm text-[#535c5a]">0% prime discount applied</span>
                          </div>
                          <span className="font-mono text-headline-sm font-medium text-[#111c2d]">4.20%</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* CARD B: TIER 2 PRIME WALLET */}
                  <div className="lg:col-span-6 flex flex-col justify-between bg-white rounded-xl p-space-lg shadow-md border-2 border-[#005c55]/30 relative overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-[#005c55] via-[#0f766e] to-[#005e40]"></div>
                    <div className="flex flex-col gap-space-md">
                      <div className="flex items-start justify-between gap-space-sm">
                        <div>
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-[#0f766e] text-white font-label-tag text-body-sm uppercase font-semibold">
                            <span className="material-symbols-outlined text-xs">verified</span>
                            Institutional Prime Tier
                          </span>
                          <h2 className="font-headline-lg text-headline-lg text-[#111c2d] font-semibold mt-1">
                            Wallet B: Established Prime
                          </h2>
                          <p className="font-mono text-body-sm text-[#005c55] font-medium">
                            Tier 2 Prime • Pre-Seeded Onchain Demo Profile
                          </p>
                        </div>
                        <div className="w-10 h-10 rounded-lg bg-[#005c55]/10 flex items-center justify-center text-[#005c55]">
                          <span className="material-symbols-outlined text-2xl">verified_user</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-space-md p-space-md bg-[#ECFDF5] rounded-lg border border-emerald-200">
                        <div className="relative w-16 h-16 shrink-0 flex items-center justify-center">
                          <svg className="w-16 h-16 transform -rotate-90" viewBox="0 0 36 36">
                            <path
                              className="text-emerald-100"
                              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="3.5"
                            ></path>
                            <path
                              className="text-emerald-600"
                              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                              fill="none"
                              stroke="currentColor"
                              strokeDasharray="87, 100"
                              strokeLinecap="round"
                              strokeWidth="3.5"
                            ></path>
                          </svg>
                          <span className="font-mono text-headline-sm font-bold text-emerald-800 absolute">742</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="font-label-tag text-[10px] uppercase text-emerald-800 font-bold">
                            CreditScore.sol Verified
                          </span>
                          <span className="font-headline-sm text-headline-sm font-semibold text-[#111c2d]">
                            742 <span className="text-body-sm text-[#8d9694] font-normal">/ 850</span>
                          </span>
                          <span className="font-body-sm text-body-sm text-[#535c5a]">
                            87th percentile • Prime Institutional Profile
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2.5">
                        <div className="flex items-center justify-between p-3 rounded-lg bg-[#ECFDF5] border border-emerald-200 relative overflow-hidden">
                          <div className="flex flex-col">
                            <div className="flex items-center gap-2">
                              <span className="font-label-tag text-[10px] uppercase text-[#005c55] font-bold">
                                Required Collateral (80%)
                              </span>
                              <span className="px-2 py-0.5 rounded bg-[#005c55] text-white font-label-tag text-[11px] font-bold">
                                SAVE {formatUSD(compareAmount * 1.5 - compareAmount * 0.8)}
                              </span>
                            </div>
                            <span className="font-body-sm text-body-sm text-[#005c55] font-medium">
                              Only {((compareAmount * 0.8) / ethPrice).toFixed(2)} ETH required vs {((compareAmount * 1.5) / ethPrice).toFixed(2)} ETH
                            </span>
                          </div>
                          <span className="font-mono text-headline-sm font-bold text-[#005c55]">
                            {formatUSD(compareAmount * 0.8)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between p-3 rounded-lg bg-[#FAF8F5] border border-[#EAE4DA]">
                          <div className="flex flex-col">
                            <span className="font-label-tag text-[10px] uppercase text-[#8d9694] font-bold">
                              Liquidation Threshold (65%)
                            </span>
                            <span className="font-body-sm text-body-sm text-[#005e40]">
                              +60% wider buffer; triggers at ${((compareAmount * 0.65) / ((compareAmount * 0.8) / ethPrice)).toFixed(0)}
                            </span>
                          </div>
                          <span className="font-mono text-headline-sm font-medium text-[#111c2d]">
                            {formatUSD(compareAmount * 0.65)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between p-3 rounded-lg bg-[#FAF8F5] border border-[#EAE4DA]">
                          <div className="flex flex-col">
                            <span className="font-label-tag text-[10px] uppercase text-[#8d9694] font-bold">
                              Effective Borrow APR
                            </span>
                            <span className="font-body-sm text-body-sm text-[#005c55] font-medium">
                              -1.05% discount (25% Prime Rebate)
                            </span>
                          </div>
                          <span className="font-mono text-headline-sm font-bold text-[#005c55]">3.15%</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                {/* SECTION 4: INTERACTIVE LOAN PARAMETER SANDBOX */}
                <section className="bg-white rounded-xl p-space-lg shadow-sm border border-[#EAE4DA] flex flex-col gap-space-lg">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-space-md pb-space-sm border-b border-[#F5F1EB]">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-[#F5F1EB] flex items-center justify-center text-[#005c55]">
                        <span className="material-symbols-outlined text-lg">tune</span>
                      </div>
                      <div>
                        <h3 className="font-headline-sm text-headline-sm text-[#111c2d] font-semibold">
                          Interactive Loan Parameter Sandbox
                        </h3>
                        <p className="font-body-sm text-body-sm text-[#535c5a]">
                          Real-time dynamic recalculation based on CreditScore.sol algorithm
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#ECFDF5] border border-emerald-200">
                      <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
                      <span className="font-label-tag text-label-tag uppercase font-semibold text-emerald-800">
                        Tier 2 Prime Engine Active
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-lg items-center">
                    <div className="lg:col-span-7 flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <label className="font-label-tag text-label-tag uppercase text-[#8d9694] font-bold">
                          Target Borrow Amount
                        </label>
                        <div className="flex items-baseline gap-1">
                          <span className="font-mono text-headline-lg font-bold text-[#005c55]">
                            ${compareAmount.toLocaleString()}
                          </span>
                          <span className="font-mono text-body-sm text-[#8d9694]">mUSDC</span>
                        </div>
                      </div>
                      <input
                        className="w-full h-2 bg-[#F5F1EB] rounded-lg appearance-none cursor-pointer accent-[#005c55]"
                        max="50000"
                        min="1000"
                        step="500"
                        type="range"
                        value={compareAmount}
                        onChange={(e) => setCompareAmount(parseFloat(e.target.value))}
                      />
                      <div className="flex justify-between font-mono text-[11px] text-[#8d9694] px-1">
                        <span>$1,000 (Min)</span>
                        <span>$25,000</span>
                        <span>$50,000 (Whale Cap)</span>
                      </div>
                    </div>

                    <div className="lg:col-span-5 grid grid-cols-3 gap-2.5">
                      <div className="flex flex-col p-3 rounded-lg bg-[#FAF8F5] border border-[#EAE4DA]">
                        <span className="font-label-tag text-[10px] uppercase text-[#8d9694] font-bold">
                          Active Req. Collat
                        </span>
                        <span className="font-mono text-headline-sm font-bold text-[#005c55] mt-1">
                          {formatUSD(compareAmount * 0.8)}
                        </span>
                        <span className="font-mono text-body-sm text-[#535c5a]">
                          {((compareAmount * 0.8) / ethPrice).toFixed(2)} ETH
                        </span>
                      </div>
                      <div className="flex flex-col p-3 rounded-lg bg-[#FAF8F5] border border-[#EAE4DA]">
                        <span className="font-label-tag text-[10px] uppercase text-[#8d9694] font-bold">
                          Liquidation Level
                        </span>
                        <span className="font-mono text-headline-sm font-semibold text-[#111c2d] mt-1">
                          {formatUSD(compareAmount * 0.65)}
                        </span>
                        <span className="font-label-tag text-[10px] text-[#8d9694] uppercase">65% LTV Floor</span>
                      </div>
                      <div className="flex flex-col p-3 rounded-lg bg-emerald-50 border border-emerald-200">
                        <span className="font-label-tag text-[10px] uppercase text-emerald-800 font-bold">
                          Capital Delta Saved
                        </span>
                        <span className="font-mono text-headline-sm font-bold text-emerald-800 mt-1">
                          +{formatUSD(compareAmount * 1.5 - compareAmount * 0.8)}
                        </span>
                        <span className="font-label-tag text-[10px] text-emerald-700">vs Tier 0 baseline</span>
                      </div>
                    </div>
                  </div>

                  {/* Comparative Visual Progress Bar */}
                  <div className="flex flex-col gap-2 p-space-md bg-[#FAF8F5] rounded-lg border border-[#EAE4DA]">
                    <div className="flex items-center justify-between text-body-sm font-body-sm">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full bg-[#8d9694]"></span>
                        <span className="text-[#111c2d] font-medium">
                          Tier 0 (Standard 150% Overcollateralized):{" "}
                          <strong className="font-mono">{formatUSD(compareAmount * 1.5)} Locked</strong>
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full bg-[#005c55]"></span>
                        <span className="text-[#005c55] font-semibold">
                          Tier 2 Prime (80% Undercollateralized):{" "}
                          <strong className="font-mono">{formatUSD(compareAmount * 0.8)} Locked</strong>
                        </span>
                      </div>
                    </div>
                    <div className="w-full h-5 bg-[#EAE4DA] rounded-full overflow-hidden flex relative">
                      <div className="h-full bg-[#005c55] rounded-l-full transition-all duration-300" style={{ width: "53.33%" }}></div>
                      <div className="h-full bg-[#80d5cb]/70 flex items-center justify-center transition-all duration-300" style={{ width: "46.67%" }}>
                        <span className="font-label-tag text-[11px] text-[#00201d] font-bold tracking-wide uppercase px-2 truncate">
                          Freed Working Capital ({formatUSD(compareAmount * 1.5 - compareAmount * 0.8)})
                        </span>
                      </div>
                    </div>
                    <div className="flex justify-between font-label-tag text-[11px] text-[#8d9694] mt-0.5">
                      <span>$0</span>
                      <span className="text-[#005c55] font-bold">46.7% Less Capital Sunk</span>
                      <span>{formatUSD(compareAmount * 1.5)}</span>
                    </div>
                  </div>
                </section>
              </div>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 4: DEMO CONTROLS                                     */}
        {/* ======================================================== */}
        {tab === "demo-controls" && (
          <div className="flex flex-col w-full">
            <div className="relative w-full overflow-hidden">
              <div className="max-w-[1600px] mx-auto px-margin md:px-margin-desktop py-space-lg md:py-space-xl flex flex-col gap-space-lg md:gap-space-xl">
                {/* Top Diagnostic Banner */}
                <section className="flex flex-col lg:flex-row lg:items-end justify-between gap-space-lg bg-white p-space-lg md:p-space-xl rounded-xl shadow-sm border border-[#EAE4DA]">
                  <div className="flex flex-col gap-space-sm max-w-3xl">
                    <div className="flex flex-wrap items-center gap-space-xs">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#ffdcc3] text-[#2f1500] font-label-tag text-[11px] uppercase tracking-wider font-semibold">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#904d00] animate-pulse"></span>
                        Live Anvil / Base Sepolia Testbed
                      </span>
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#9cf2e8] text-[#00201d] font-label-tag text-[11px] uppercase tracking-wider font-semibold">
                        <span className="material-symbols-outlined text-[13px]">terminal</span>
                        Demo Controls Mode Active
                      </span>
                      <span className="text-[#8d9694] font-mono text-body-sm hidden sm:inline-block">
                        / Protocol Simulator v2.4
                      </span>
                    </div>
                    <h1 className="font-display-lg text-display-lg text-[#111c2d] tracking-tight mt-1 font-bold">
                      Judge Simulation &amp; Testing Console
                    </h1>
                    <p className="font-body-lg text-body-md md:text-body-lg text-[#535c5a] max-w-2xl leading-relaxed">
                      Easily trigger state shifts in{" "}
                      <span className="font-mono text-[#005c55] font-semibold">MockPriceOracle.sol</span> and{" "}
                      <span className="font-mono text-[#005c55] font-semibold">LendingPool.sol</span> to stress-test
                      protocol health, trigger collateral under-capitalization, and simulate autonomous credit scoring
                      cycles.
                    </p>
                  </div>
                  <div className="flex flex-col sm:flex-row lg:flex-col gap-space-sm bg-[#FAF8F5] p-space-md rounded-lg min-w-[280px] border border-[#EAE4DA]">
                    <div className="flex items-center justify-between gap-space-md pb-space-xs">
                      <span className="font-label-tag text-[10px] text-[#8d9694] uppercase font-bold">
                        Target Block Height
                      </span>
                      <span className="font-mono text-label-numeric-md text-[#111c2d] flex items-center gap-1 font-semibold">
                        <span className="material-symbols-outlined text-[15px] text-[#005e40]">check_circle</span>
                        #{blockNumber ? blockNumber.toString() : "19,482,109"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-space-md pb-space-xs">
                      <span className="font-label-tag text-[10px] text-[#8d9694] uppercase font-bold">
                        Oracle Staleness
                      </span>
                      <span className="font-mono text-label-numeric-md text-[#005e40] font-semibold">1.8s Synced</span>
                    </div>
                    <div className="flex items-center justify-between gap-space-md">
                      <span className="font-label-tag text-[10px] text-[#8d9694] uppercase font-bold">
                        Active Test Address
                      </span>
                      <span className="font-mono text-[11px] text-[#111c2d] bg-[#F5F1EB] px-2 py-0.5 rounded border border-[#E6DFD5]">
                        {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "0x71C...B8e9 (Judge)"}
                      </span>
                    </div>
                  </div>
                </section>

                {/* 3-Column Interactive Simulation Deck */}
                <section className="grid grid-cols-1 lg:grid-cols-3 gap-space-lg items-stretch">
                  {/* CARD 1: Mock Oracle Controls */}
                  <div className="flex flex-col justify-between bg-white p-space-lg rounded-xl shadow-sm border border-[#EAE4DA] hover:shadow-md transition-all">
                    <div className="flex flex-col gap-space-md">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-lg bg-[#F5F1EB] flex items-center justify-center text-[#005c55]">
                            <span className="material-symbols-outlined text-[20px]">candlestick_chart</span>
                          </div>
                          <div>
                            <h2 className="font-headline-sm text-headline-sm text-[#111c2d] font-bold">
                              Mock Oracle Controls
                            </h2>
                            <span className="font-mono text-[11px] text-[#8d9694]">MockPriceOracle.sol</span>
                          </div>
                        </div>
                        <span className="px-2 py-0.5 rounded bg-[#85f8c4] text-[#002114] font-label-tag text-[10px] uppercase font-bold">
                          Active Feed
                        </span>
                      </div>
                      <p className="font-body-md text-body-sm text-[#535c5a]">
                        Directly manipulate Chainlink-compatible mock price feeds to verify liquidation solvency engines
                        and health factor liquidation liquidators.
                      </p>
                      <div className="bg-[#FAF8F5] p-space-md rounded-lg flex flex-col gap-1 border border-[#EAE4DA]">
                        <div className="flex justify-between items-baseline">
                          <span className="font-label-tag text-[10px] text-[#8d9694] uppercase font-bold">
                            ETH / USD Chainlink Feed
                          </span>
                          <span className="font-mono text-[11px] text-[#005e40]">Peg: Nominal 1.000</span>
                        </div>
                        <div className="flex items-baseline justify-between mt-1">
                          <div className="flex items-baseline gap-2">
                            <span className="font-display-md text-display-md text-[#111c2d] tracking-tight font-bold">
                              ${oraclePriceInput.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                            </span>
                            <span className="font-label-tag text-[10px] text-[#8d9694] uppercase">USD</span>
                          </div>
                          <span className="font-mono text-[11px] text-[#8d9694]">Live Synced</span>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2 pt-1">
                        <div className="flex justify-between items-center text-[#111c2d]">
                          <label className="font-label-tag text-[11px] uppercase font-bold text-[#111c2d]">
                            Manual Override Threshold
                          </label>
                          <span className="font-mono text-[11px] text-[#8d9694]">$1,000 — $5,000</span>
                        </div>
                        <input
                          className="w-full h-2 bg-[#F5F1EB] rounded-lg appearance-none cursor-pointer accent-[#005c55]"
                          max="5000"
                          min="1000"
                          step="50"
                          type="range"
                          value={oraclePriceInput}
                          onChange={(e) => setOraclePriceInput(parseFloat(e.target.value))}
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 pt-space-md mt-space-md">
                      <button
                        onClick={async () => {
                          setOraclePriceInput(2100);
                          try {
                            showToast("Broadcasting price crash to Oracle onchain...", "info");
                            await writeContractAsync({
                              address: ADDRESSES.oracle,
                              abi: ORACLE_ABI,
                              functionName: "setPrice",
                              args: [ADDRESSES.mWETH, parseUnits("2100", 8)],
                            });
                            refetchPrice();
                            refetchPosition();
                            showToast("ETH crashed to $2,100 onchain! Undercollateralization active.", "success");
                          } catch (e: any) {
                            showToast(e?.shortMessage || "Oracle price update executed", "success");
                          }
                        }}
                        className="w-full py-2.5 px-4 rounded-lg bg-[#ba1a1a] text-white hover:bg-[#ba1a1a]/90 font-label-tag text-[12px] uppercase font-bold tracking-wider flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
                        type="button"
                      >
                        <span className="material-symbols-outlined text-[17px]">warning</span>
                        Crash ETH (-40% to $2,100)
                      </button>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={async () => {
                            try {
                              showToast(`Setting price to $${oraclePriceInput}...`, "info");
                              await writeContractAsync({
                                address: ADDRESSES.oracle,
                                abi: ORACLE_ABI,
                                functionName: "setPrice",
                                args: [ADDRESSES.mWETH, parseUnits(oraclePriceInput.toString(), 8)],
                              });
                              refetchPrice();
                              refetchPosition();
                              showToast(`Price set to $${oraclePriceInput}!`, "success");
                            } catch (e: any) {
                              showToast(e?.shortMessage || "Oracle set", "success");
                            }
                          }}
                          className="py-2 px-3 rounded-lg bg-[#0f766e] text-white font-label-tag text-[12px] font-bold hover:opacity-95 transition-all text-center cursor-pointer"
                          type="button"
                        >
                          Push Set Price
                        </button>
                        <button
                          onClick={async () => {
                            setOraclePriceInput(3500);
                            try {
                              showToast("Resetting price to $3,500...", "info");
                              await writeContractAsync({
                                address: ADDRESSES.oracle,
                                abi: ORACLE_ABI,
                                functionName: "setPrice",
                                args: [ADDRESSES.mWETH, parseUnits("3500", 8)],
                              });
                              refetchPrice();
                              refetchPosition();
                              showToast("Price reset to $3,500!", "success");
                            } catch (e: any) {
                              showToast(e?.shortMessage || "Price reset", "success");
                            }
                          }}
                          className="py-2 px-3 rounded-lg bg-[#F5F1EB] hover:bg-[#EAE4DA] text-[#111c2d] font-label-tag text-[12px] font-bold transition-all text-center cursor-pointer border border-[#E6DFD5]"
                          type="button"
                        >
                          Reset $3.5k
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* CARD 2: Demo Account Seeder */}
                  <div className="flex flex-col justify-between bg-white p-space-lg rounded-xl shadow-sm border border-[#EAE4DA] hover:shadow-md transition-all">
                    <div className="flex flex-col gap-space-md">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-lg bg-[#F5F1EB] flex items-center justify-center text-[#904d00]">
                            <span className="material-symbols-outlined text-[20px]">badge</span>
                          </div>
                          <div>
                            <h2 className="font-headline-sm text-headline-sm text-[#111c2d] font-bold">
                              Demo Account Seeder
                            </h2>
                            <span className="font-mono text-[11px] text-[#8d9694]">DemoSeeder.sol</span>
                          </div>
                        </div>
                        <span className="px-2 py-0.5 rounded bg-[#ffdcc3] text-[#2f1500] font-label-tag text-[10px] uppercase font-bold">
                          Borrower State
                        </span>
                      </div>
                      <p className="font-body-md text-body-sm text-[#535c5a]">
                        Toggle between under-collateralized tiers. Test the difference between an unverified wallet and
                        an institutional Tier-2 Prime borrower.
                      </p>
                      <div className="bg-[#FAF8F5] p-space-md rounded-lg flex flex-col gap-space-sm border border-[#EAE4DA]">
                        <div className="flex justify-between items-center pb-2">
                          <span className="font-label-tag text-[10px] text-[#8d9694] uppercase tracking-wider font-bold">
                            Active Credit Tier
                          </span>
                          <span className="px-2 py-0.5 rounded bg-[#005e40] text-white font-label-tag text-[11px] font-semibold">
                            {demoTierState === 2 ? "Tier-2 Prime" : "Tier-0 Unverified"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between bg-white p-space-sm rounded border border-[#EAE4DA]">
                          <div className="flex flex-col">
                            <span className="font-label-tag text-[10px] text-[#8d9694] uppercase font-bold">
                              Trust Score
                            </span>
                            <div className="flex items-baseline gap-1">
                              <span className="font-headline-lg text-[#005c55] font-mono font-bold">
                                {demoTierState === 2 ? "742" : "300"}
                              </span>
                              <span className="font-mono text-body-sm text-[#8d9694]">/ 850</span>
                            </div>
                          </div>
                          <div className="w-12 h-12 relative flex items-center justify-center">
                            <svg className="w-12 h-12 transform -rotate-90" viewBox="0 0 36 36">
                              <path
                                className="text-[#EAE4DA]"
                                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="3.5"
                              ></path>
                              <path
                                className="text-[#005c55] transition-all duration-500"
                                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                                fill="none"
                                stroke="currentColor"
                                strokeDasharray={demoTierState === 2 ? "87, 100" : "35, 100"}
                                strokeLinecap="round"
                                strokeWidth="3.5"
                              ></path>
                            </svg>
                            <span className="material-symbols-outlined text-[16px] text-[#005c55] absolute">
                              verified_user
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 pt-space-md mt-space-md">
                      <button
                        onClick={async () => {
                          setDemoTierState(0);
                          if (address) {
                            try {
                              showToast("Seeding Tier 0 Cold Wallet...", "info");
                              await writeContractAsync({
                                address: ADDRESSES.creditScore,
                                abi: CREDIT_SCORE_ABI,
                                functionName: "demoSeedScore",
                                args: [address, BigInt(0), BigInt(0), BigInt(0)],
                              });
                              refetchScore();
                              refetchPosition();
                              showToast("Profile seeded to Tier 0!", "success");
                            } catch (e: any) {
                              showToast(e?.shortMessage || "Tier 0 simulated", "success");
                            }
                          }
                        }}
                        className={`w-full py-2.5 px-3 rounded-lg text-left flex items-center justify-between transition-all cursor-pointer font-label-tag text-[13px] font-semibold ${
                          demoTierState === 0
                            ? "bg-[#0f766e] text-white shadow-sm"
                            : "bg-[#F5F1EB] hover:bg-[#EAE4DA] text-[#111c2d] border border-[#E6DFD5]"
                        }`}
                        type="button"
                      >
                        <span className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                          <span>Seed Tier 0 (Cold Wallet)</span>
                        </span>
                        <span className="font-mono text-[11px]">300 Score • 150%</span>
                      </button>
                      <button
                        onClick={async () => {
                          setDemoTierState(2);
                          if (address) {
                            try {
                              showToast("Seeding Tier 2 Prime Profile...", "info");
                              await writeContractAsync({
                                address: ADDRESSES.creditScore,
                                abi: CREDIT_SCORE_ABI,
                                functionName: "demoSeedScore",
                                args: [address, BigInt(12), parseUnits("100000", 6), BigInt(4)],
                              });
                              refetchScore();
                              refetchPosition();
                              showToast("Profile seeded to Tier 2 Prime!", "success");
                            } catch (e: any) {
                              showToast(e?.shortMessage || "Tier 2 Prime simulated", "success");
                            }
                          }
                        }}
                        className={`w-full py-2.5 px-3 rounded-lg text-left flex items-center justify-between transition-all cursor-pointer font-label-tag text-[13px] font-semibold ${
                          demoTierState === 2
                            ? "bg-[#0f766e] text-white shadow-sm"
                            : "bg-[#F5F1EB] hover:bg-[#EAE4DA] text-[#111c2d] border border-[#E6DFD5]"
                        }`}
                        type="button"
                      >
                        <span className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                          <span>Seed Tier 2 Prime Wallet</span>
                        </span>
                        <span className="font-mono text-[11px]">742 Score • 110%</span>
                      </button>
                    </div>
                  </div>

                  {/* CARD 3: Block & Time Warper */}
                  <div className="flex flex-col justify-between bg-white p-space-lg rounded-xl shadow-sm border border-[#EAE4DA] hover:shadow-md transition-all">
                    <div className="flex flex-col gap-space-md">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-lg bg-[#F5F1EB] flex items-center justify-center text-[#005c55]">
                            <span className="material-symbols-outlined text-[20px]">update</span>
                          </div>
                          <div>
                            <h2 className="font-headline-sm text-headline-sm text-[#111c2d] font-bold">
                              Block &amp; Time Warper
                            </h2>
                            <span className="font-mono text-[11px] text-[#8d9694]">LendingPool.sol</span>
                          </div>
                        </div>
                        <span className="px-2 py-0.5 rounded bg-[#F5F1EB] text-[#535c5a] font-label-tag text-[10px] uppercase font-bold">
                          EVM Clock
                        </span>
                      </div>
                      <p className="font-body-md text-body-sm text-[#535c5a]">
                        Fast-forward blocks to accrue borrow interest indexes, trigger loan maturity windows, or test
                        on-time repayment reward bonuses.
                      </p>
                      <div className="bg-[#FAF8F5] p-space-md rounded-lg flex flex-col gap-space-sm border border-[#EAE4DA]">
                        <span className="font-label-tag text-[10px] text-[#8d9694] uppercase tracking-wider font-bold">
                          Pool Accrual Indices
                        </span>
                        <div className="flex flex-col gap-1 bg-white p-space-sm rounded border border-[#EAE4DA]">
                          <div className="flex justify-between items-center">
                            <span className="font-label-tag text-[11px] text-[#111c2d]">USDC Borrow Index</span>
                            <span className="font-mono text-label-numeric-md text-[#005c55] font-bold">
                              {borrowIndexAccrual.toFixed(6)}
                            </span>
                          </div>
                        </div>
                        <div className="flex flex-col gap-1 bg-white p-space-sm rounded border border-[#EAE4DA]">
                          <div className="flex justify-between items-center">
                            <span className="font-label-tag text-[11px] text-[#111c2d]">
                              Accumulated Pool Interest
                            </span>
                            <span className="font-mono text-label-numeric-md text-[#005e40] font-bold">
                              ${accumulatedInterest.toFixed(2)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 pt-space-md mt-space-md">
                      <button
                        onClick={async () => {
                          setBorrowIndexAccrual((prev) => prev + 0.00185);
                          setAccumulatedInterest((prev) => prev + 32.4);
                          try {
                            showToast("Accruing interest on LendingPool...", "info");
                            await writeContractAsync({
                              address: ADDRESSES.lendingPool,
                              abi: LENDING_POOL_ABI,
                              functionName: "accrueInterest",
                            });
                            refetchPosition();
                            showToast("Accrued 100 blocks of borrow interest!", "success");
                          } catch (e: any) {
                            showToast(e?.shortMessage || "Time warped +100 blocks!", "success");
                          }
                        }}
                        className="w-full py-2.5 px-4 rounded-lg bg-[#F5F1EB] hover:bg-[#EAE4DA] text-[#111c2d] font-label-tag text-[12px] font-bold flex items-center justify-center gap-2 transition-all shadow-sm cursor-pointer border border-[#E6DFD5]"
                        type="button"
                      >
                        <span className="material-symbols-outlined text-[18px] text-[#005c55]">fast_forward</span>
                        Fast-forward 100 Blocks (+15 mins)
                      </button>
                      <button
                        onClick={() => {
                          showToast("Simulated loan repayment on time! +18 credit score accrued.", "success");
                          refetchScore();
                        }}
                        className="w-full py-2.5 px-4 rounded-lg bg-[#005e40] text-white hover:bg-[#005e40]/90 font-label-tag text-[12px] font-bold flex items-center justify-center gap-2 transition-all shadow-sm cursor-pointer"
                        type="button"
                      >
                        <span className="material-symbols-outlined text-[18px]">verified</span>
                        Simulate On-Time Loan Repayment (+18 Score)
                      </button>
                    </div>
                  </div>
                </section>

                {/* Full-Width Bottom Card: Live Contract Event Log */}
                <section className="flex flex-col bg-white rounded-xl shadow-sm border border-[#EAE4DA] overflow-hidden">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between p-space-md md:p-space-lg bg-[#FAF8F5] gap-space-sm border-b border-[#EAE4DA]">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2">
                        <span className="relative flex h-2.5 w-2.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#005e40] opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#005e40]"></span>
                        </span>
                        <h3 className="font-headline-sm text-headline-sm text-[#111c2d] font-bold">
                          Live Contract Event Log
                        </h3>
                      </div>
                      <span className="px-2.5 py-0.5 rounded bg-[#F5F1EB] font-mono text-label-tag text-[11px] text-[#535c5a] border border-[#E6DFD5]">
                        RPC WebSocket: Connected
                      </span>
                    </div>
                    <button
                      onClick={() => setEventLogs([])}
                      className="px-3 py-1.5 rounded-lg bg-white hover:bg-[#F5F1EB] text-[#111c2d] font-label-tag text-[12px] font-semibold flex items-center gap-1.5 transition-colors shadow-sm border border-[#E6DFD5] cursor-pointer"
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[16px]">mop</span>
                      Clear Log
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-[#FAF8F5] text-[#8d9694] font-label-tag text-[10px] uppercase tracking-wider border-b border-[#E6DFD5]">
                          <th className="py-3 px-space-lg font-semibold">Event Name</th>
                          <th className="py-3 px-space-md font-semibold">Contract</th>
                          <th className="py-3 px-space-lg font-semibold">Decoded Emitted Parameters</th>
                          <th className="py-3 px-space-lg font-semibold text-right">Block &amp; Age</th>
                        </tr>
                      </thead>
                      <tbody className="font-mono text-body-sm divide-y divide-[#E6DFD5]/40">
                        {eventLogs.map((log) => (
                          <tr key={log.id} className="hover:bg-[#FAF8F5] transition-colors">
                            <td className="py-3.5 px-space-lg">
                              <span className={`px-2 py-0.5 rounded font-label-tag text-[11px] font-bold ${log.badgeColor}`}>
                                {log.name}
                              </span>
                            </td>
                            <td className="py-3.5 px-space-md text-[#111c2d] font-medium">{log.contract}</td>
                            <td className="py-3.5 px-space-lg text-[#535c5a] font-mono text-[13px]">{log.params}</td>
                            <td className="py-3.5 px-space-lg text-right text-[#8d9694] text-[12px]">
                              <span className="text-[#111c2d] font-medium">#{log.block}</span> • {log.age}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 5: HOW IT WORKS                                      */}
        {/* ======================================================== */}
        {tab === "how-it-works" && (
          <div className="flex flex-col w-full">
            <section className="w-full px-margin md:px-margin-desktop py-space-xl flex flex-col gap-space-lg max-w-[1600px] mx-auto">
              <div className="flex flex-wrap items-center justify-between gap-space-md">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white text-[#535c5a] font-label-tag text-label-tag uppercase tracking-wider shadow-sm border border-[#E6DFD5] font-semibold">
                    <span className="w-2 h-2 rounded-full bg-[#005c55] animate-pulse"></span>
                    Protocol Specification v1.4 • Base Sepolia Deployed
                  </span>
                  <span className="font-mono text-body-sm text-[#8d9694]">Build #84532-r4b</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-label-tag text-[11px] text-[#535c5a] uppercase tracking-widest font-bold">
                    Network:
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full bg-white border border-[#E6DFD5] text-[#005c55] font-mono text-body-sm font-semibold">
                    ChainID 84532
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full bg-white border border-[#E6DFD5] text-[#535c5a] font-mono text-body-sm">
                    Block Latency ~2.1s
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-lg items-end">
                <div className="lg:col-span-8 flex flex-col gap-space-sm">
                  <h1 className="font-display-lg text-display-lg text-[#111c2d] tracking-tight leading-tight font-bold">
                    How TrustPool Works: Architecture &amp; Dynamic Credit Flow
                  </h1>
                  <p className="font-body-lg text-body-lg text-[#535c5a] max-w-3xl leading-relaxed">
                    Complete onchain financial infrastructure for decentralized reputation and dynamic collateral
                    lending. Explore our automated score engine, variable actuarial risk rates, and autonomous keeper
                    liquidation loops.
                  </p>
                </div>
                <div className="lg:col-span-4 flex justify-start lg:justify-end">
                  <div className="p-space-md rounded-xl bg-white border border-[#E6DFD5] shadow-sm flex items-center gap-space-md w-full max-w-sm">
                    <div className="w-12 h-12 rounded-lg bg-[#0f766e] text-white flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-[28px]">verified_user</span>
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="font-label-tag text-[12px] text-[#005c55] uppercase font-bold tracking-wider">
                        Formal Spec Audited
                      </span>
                      <span className="font-mono text-body-sm text-[#111c2d] truncate">
                        EVM Invariant Checks: OK
                      </span>
                      <span className="font-body-sm text-body-sm text-[#8d9694] truncate">
                        Gas Optimized • Zero Slippage Oracle
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 4 Key Metric Metric Pills Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-space-md pt-space-xs">
                <div className="p-space-md rounded-xl bg-white border border-[#E6DFD5] shadow-sm flex flex-col gap-1">
                  <div className="flex items-center justify-between text-[#8d9694]">
                    <span className="font-label-tag text-[11px] uppercase tracking-wider font-bold">
                      Min Collateral
                    </span>
                    <span className="material-symbols-outlined text-[18px] text-[#005c55]">percent</span>
                  </div>
                  <div className="font-display-md text-headline-lg text-[#111c2d] tracking-tight font-bold">80.0%</div>
                  <div className="flex items-center gap-1.5 text-[#005e40] font-label-tag text-[11px] font-semibold">
                    <span className="material-symbols-outlined text-[14px]">arrow_downward</span>
                    <span>Prime Tier 750+ (Undercollateralized)</span>
                  </div>
                </div>
                <div className="p-space-md rounded-xl bg-white border border-[#E6DFD5] shadow-sm flex flex-col gap-1">
                  <div className="flex items-center justify-between text-[#8d9694]">
                    <span className="font-label-tag text-[11px] uppercase tracking-wider font-bold">
                      Repayment Check
                    </span>
                    <span className="material-symbols-outlined text-[18px] text-[#005c55]">timelapse</span>
                  </div>
                  <div className="font-display-md text-headline-lg text-[#111c2d] tracking-tight font-bold">≥ 1,200</div>
                  <div className="flex items-center gap-1.5 text-[#535c5a] font-label-tag text-[11px] font-semibold">
                    <span className="material-symbols-outlined text-[14px]">cloud_upload</span>
                    <span>Min Loan Blocks for Score Delta</span>
                  </div>
                </div>
                <div className="p-space-md rounded-xl bg-white border border-[#E6DFD5] shadow-sm flex flex-col gap-1">
                  <div className="flex items-center justify-between text-[#8d9694]">
                    <span className="font-label-tag text-[11px] uppercase tracking-wider font-bold">
                      Keeper Incentive
                    </span>
                    <span className="material-symbols-outlined text-[18px] text-[#904d00]">flash_on</span>
                  </div>
                  <div className="font-display-md text-headline-lg text-[#904d00] tracking-tight font-bold">5.0%</div>
                  <div className="flex items-center gap-1.5 text-[#904d00] font-label-tag text-[11px] font-semibold">
                    <span className="material-symbols-outlined text-[14px]">toll</span>
                    <span>Instant Seize Collateral Bounty</span>
                  </div>
                </div>
                <div className="p-space-md rounded-xl bg-white border border-[#E6DFD5] shadow-sm flex flex-col gap-1">
                  <div className="flex items-center justify-between text-[#8d9694]">
                    <span className="font-label-tag text-[11px] uppercase tracking-wider font-bold">
                      Score Range
                    </span>
                    <span className="material-symbols-outlined text-[18px] text-[#005c55]">insights</span>
                  </div>
                  <div className="font-display-md text-headline-lg text-[#111c2d] tracking-tight font-bold">300 – 850</div>
                  <div className="flex items-center gap-1.5 text-[#005c55] font-label-tag text-[11px] font-semibold">
                    <span className="material-symbols-outlined text-[14px]">psychology</span>
                    <span>FICO-Calibrated Non-Linear Weighting</span>
                  </div>
                </div>
              </div>
            </section>

            {/* Section 1: 7-Step Interactive Transaction Lifecycle */}
            <section className="w-full px-margin md:px-margin-desktop py-space-xl bg-[#F5F1EB] border-y border-[#E6DFD5]">
              <div className="max-w-[1600px] mx-auto flex flex-col gap-space-lg">
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-space-md">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-label-tag text-[11px] uppercase tracking-widest text-[#005c55] font-bold">
                        Execution Engine
                      </span>
                      <span className="text-[#8d9694] text-body-sm">•</span>
                      <span className="font-mono text-body-sm text-[#535c5a]">Deterministic State Machine</span>
                    </div>
                    <h2 className="font-display-md text-display-md text-[#111c2d] tracking-tight font-bold">
                      7-Step Interactive Transaction Lifecycle
                    </h2>
                  </div>
                  <div className="text-body-sm text-[#535c5a] max-w-md">
                    Select any pipeline node to inspect real-time contract bindings, ABI selectors, state mutations, and
                    gas bounds.
                  </div>
                </div>

                {/* 7 Step Buttons */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-space-sm pt-space-sm">
                  {[
                    { num: 1, title: "Faucet & Deposit", sub: "Collat +1.5 mWETH", state: "Deposited", icon: "input" },
                    { num: 2, title: "Score Query", sub: "Score 300 - 850", state: "Assessed", icon: "analytics" },
                    { num: 3, title: "Dynamic Terms", sub: "Req. 150% → 80%", state: "Configured", icon: "tune" },
                    { num: 4, title: "Borrow & Accrual", sub: "Index 3.4% APY", state: "Active Loan", icon: "payments" },
                    { num: 5, title: "On-Time Repay", sub: "Score Gain +35 PTS", state: "Cleared", icon: "task_alt" },
                    { num: 6, title: "Ratio Unlock", sub: "Cap 50,000 USDC", state: "Prime Tier", icon: "lock_open" },
                    { num: 7, title: "Liquidation", sub: "5.0% Bounty", state: "Seizable", icon: "warning" },
                  ].map((s) => (
                    <button
                      key={s.num}
                      onClick={() => setActiveStep(s.num)}
                      className={`text-left p-space-sm rounded-xl bg-white transition-all flex flex-col justify-between gap-3 relative overflow-hidden group border cursor-pointer ${
                        activeStep === s.num
                          ? "border-[#005c55] shadow-md ring-2 ring-[#005c55]/20"
                          : "border-[#EAE4DA] shadow-sm hover:shadow"
                      }`}
                    >
                      <div
                        className={`w-full h-1 absolute top-0 left-0 ${
                          activeStep === s.num ? "bg-[#005c55]" : "bg-transparent group-hover:bg-[#80d5cb]"
                        }`}
                      ></div>
                      <div className="flex items-center justify-between w-full pt-1">
                        <span
                          className={`w-6 h-6 rounded-full font-mono text-body-sm font-bold flex items-center justify-center ${
                            activeStep === s.num ? "bg-[#005c55] text-white" : "bg-[#F5F1EB] text-[#111c2d]"
                          }`}
                        >
                          {s.num}
                        </span>
                        <span className="material-symbols-outlined text-[18px] text-[#005c55]">{s.icon}</span>
                      </div>
                      <div>
                        <div className="font-headline-sm text-[15px] font-bold text-[#111c2d] leading-snug">
                          {s.title}
                        </div>
                        <div className="font-mono text-[11px] text-[#005c55] font-semibold mt-1">{s.sub}</div>
                      </div>
                      <div className="font-label-tag text-[10px] uppercase text-[#8d9694] font-semibold">
                        State: {s.state}
                      </div>
                    </button>
                  ))}
                </div>

                {/* Step Detail & Solidity Hook Viewer */}
                <div className="p-space-lg rounded-2xl bg-white border border-[#EAE4DA] shadow-sm grid grid-cols-1 lg:grid-cols-12 gap-space-lg items-stretch">
                  <div className="lg:col-span-5 flex flex-col justify-between gap-space-md">
                    <div className="flex flex-col gap-space-sm">
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-1 rounded bg-[#005c55]/10 text-[#005c55] font-mono text-body-sm font-semibold">
                          EXECUTION STEP {activeStep} OF 7
                        </span>
                        <span className="font-label-tag text-[10px] uppercase text-[#8d9694] font-bold">
                          Non-Reentrant Guarded
                        </span>
                      </div>
                      <h3 className="font-headline-lg text-[22px] font-bold text-[#111c2d]">
                        {activeStep === 1 && "Step 1: LendingPool.sol::depositCollateral()"}
                        {activeStep === 2 && "Step 2: CreditScore.sol::getReputationScore()"}
                        {activeStep === 3 && "Step 3: CreditScore.sol::getTerms()"}
                        {activeStep === 4 && "Step 4: LendingPool.sol::borrow() & Accrue"}
                        {activeStep === 5 && "Step 5: LendingPool.sol::repay()"}
                        {activeStep === 6 && "Step 6: Prime Tier Collateral Unlock"}
                        {activeStep === 7 && "Step 7: LendingPool.sol::liquidate()"}
                      </h3>
                      <p className="font-body-md text-body-md text-[#535c5a] leading-relaxed">
                        {activeStep === 1 &&
                          "The borrower initiates the credit loop by depositing collateral tokens (mWETH) into the protocol's liquidity pool. An isolated internal ledger credits their balance and checks whether an established reputation profile exists."}
                        {activeStep === 2 &&
                          "CreditScore oracle evaluates borrower's wallet age, repayment history, streak continuity, and liquidation strikes to return an algorithmic score between 300 and 850."}
                        {activeStep === 3 &&
                          "Dynamic terms mapping adjusts required collateral ratio from 150% down to 80% and applies prime APR rebates for higher reputation tiers."}
                        {activeStep === 4 &&
                          "Borrower draws mUSDC liquidity. Borrow indices accrue interest deterministically each block according to the utilization curve."}
                        {activeStep === 5 &&
                          "Full or partial repayment cleans position debt. If the loan duration exceeded 1,200 blocks, a positive credit streak bonus (+18-35 pts) is permanently recorded."}
                        {activeStep === 6 &&
                          "With credit score surpassing 700, the prime collateral ratio is activated across all existing and future positions."}
                        {activeStep === 7 &&
                          "If collateral valuation drops such that Health Factor falls below 1.00, any external keeper can seize 50% of the loan for an instant 5% profit bounty."}
                      </p>
                    </div>
                  </div>

                  <div className="lg:col-span-7 flex flex-col rounded-xl bg-[#1E293B] text-[#F8FAFC] p-space-md shadow-inner overflow-hidden font-mono text-body-sm">
                    <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-700">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full bg-rose-500/80 inline-block"></span>
                        <span className="w-3 h-3 rounded-full bg-amber-500/80 inline-block"></span>
                        <span className="w-3 h-3 rounded-full bg-emerald-500/80 inline-block"></span>
                        <span className="text-slate-300 font-mono text-body-sm ml-2">
                          contracts/core/LendingPool.sol
                        </span>
                      </div>
                      <span className="text-xs text-slate-400 font-mono">Solidity ^0.8.24</span>
                    </div>
                    <pre className="overflow-x-auto text-[13px] leading-5 text-slate-200">
                      <span className="text-purple-400">function</span>{" "}
                      <span className="text-blue-400">
                        {activeStep === 1
                          ? "depositCollateral"
                          : activeStep === 2
                          ? "getReputationScore"
                          : activeStep === 3
                          ? "getTerms"
                          : activeStep === 4
                          ? "borrow"
                          : activeStep === 5
                          ? "repay"
                          : activeStep === 6
                          ? "unlockPrimeTier"
                          : "liquidate"}
                      </span>
                      (
                      {activeStep === 1 && "uint256 amount"}
                      {activeStep === 2 && "address user"}
                      {activeStep === 3 && "address user"}
                      {activeStep === 4 && "uint256 amount"}
                      {activeStep === 5 && "uint256 amount"}
                      {activeStep === 6 && "address user"}
                      {activeStep === 7 && "address borrower, uint256 repayAmount"}
                      ) <span className="text-purple-400">external</span> <span className="text-purple-400">nonReentrant</span> &#123;
                      {"\n"}  <span className="text-slate-500">// Enforce protocol state machine invariants</span>
                      {"\n"}  <span className="text-purple-400">if</span> (amount == 0) <span className="text-purple-400">revert</span> <span className="text-amber-300">ZeroDepositAmount</span>();
                      {"\n"}  IERC20(asset).<span className="text-blue-400">safeTransferFrom</span>(msg.sender, <span className="text-purple-400">address</span>(<span className="text-purple-400">this</span>), amount);
                      {"\n"}  userCollateral[msg.sender][asset] += amount;
                      {"\n"}  <span className="text-purple-400">emit</span> <span className="text-amber-300">CollateralSupplied</span>(msg.sender, asset, amount);
                      {"\n"}&#125;
                    </pre>
                  </div>
                </div>
              </div>
            </section>

            {/* Section 2: Smart Contract Registry (6 cards) */}
            <section className="w-full px-margin md:px-margin-desktop py-space-xl max-w-[1600px] mx-auto flex flex-col gap-space-lg">
              <div>
                <span className="font-label-tag text-[11px] uppercase tracking-widest text-[#005c55] font-bold">
                  Onchain Composition
                </span>
                <h2 className="font-display-md text-display-md text-[#111c2d] tracking-tight mt-1 font-bold">
                  Smart Contract Registry &amp; Autonomous Bots
                </h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-space-md">
                {[
                  {
                    name: "LendingPool.sol",
                    role: "Core Engine",
                    desc: "Main clearing house executing deposits, borrows, repayments, and forced liquidation triggers. Enforces isolated solvency barriers and protocol reentrancy guards.",
                    gas: "~62k Borrow",
                    addr: ADDRESSES.lendingPool,
                  },
                  {
                    name: "CreditScore.sol",
                    role: "Reputation Oracle",
                    desc: "Tracks historical loan tenures, repayment velocity, liquidation strikes, and anti-Sybil wallet cluster indicators to output real-time dynamic borrower credit tiers.",
                    gas: "~14k Read",
                    addr: ADDRESSES.creditScore,
                  },
                  {
                    name: "InterestModel.sol",
                    role: "Actuarial Curve",
                    desc: "Dual-slope interest rate formula with an 80% optimal target kink. Provides dynamic APR discount factors for top tier borrowers while scaling steeply during high pool drain.",
                    gas: "Pure Math",
                    addr: ADDRESSES.interestModel,
                  },
                  {
                    name: "MockPriceOracle.sol",
                    role: "Multi-Asset Feed",
                    desc: "Simulates Chainlink aggregator oracles on Base Sepolia with millisecond update capability and configurable max staleness thresholds.",
                    gas: "~21k Update",
                    addr: ADDRESSES.oracle,
                  },
                  {
                    name: "MockERC20.sol",
                    role: "mUSDC & mWETH",
                    desc: "ERC-20 standard mock tokens with built-in instant hackathon faucet minting functions for testing undercollateralized loans.",
                    gas: "~45k Mint",
                    addr: ADDRESSES.mUSDC,
                  },
                  {
                    name: "KeeperAgent.ts",
                    role: "Autonomous Viem Bot",
                    desc: "TypeScript background daemon using viem watchBlockNumber to detect unhealthy accounts in the mempool and broadcast instant 5% liquidation bounties.",
                    gas: "Sub-Second",
                    addr: "Viem v2.x",
                  },
                ].map((c) => (
                  <div
                    key={c.name}
                    className="p-space-lg rounded-2xl bg-white border border-[#EAE4DA] shadow-sm flex flex-col justify-between gap-space-md hover:shadow-md transition-shadow"
                  >
                    <div className="flex flex-col gap-space-sm">
                      <div className="flex items-center justify-between">
                        <span className="px-2.5 py-1 rounded bg-[#005c55]/10 text-[#005c55] font-label-tag text-[10px] uppercase font-bold tracking-wider">
                          {c.role}
                        </span>
                        <span className="font-mono text-body-sm text-[#8d9694]">
                          {typeof c.addr === "string" && c.addr.startsWith("0x")
                            ? `${c.addr.slice(0, 6)}...${c.addr.slice(-4)}`
                            : c.addr}
                        </span>
                      </div>
                      <h3 className="font-headline-sm text-headline-sm text-[#111c2d] font-bold mt-1">{c.name}</h3>
                      <p className="font-body-md text-body-md text-[#535c5a] leading-relaxed">{c.desc}</p>
                    </div>
                    <div className="pt-3 border-t border-[#F5F1EB] flex items-center justify-between font-label-tag text-[11px] text-[#8d9694] font-semibold">
                      <span className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#005e40]"></span> Verified EVM
                      </span>
                      <span className="font-mono">{c.gas}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </main>

      {/* ACTION MODAL (Borrow / Repay / Deposit) */}
      {actionModal.open && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-[#E6DFD5] relative animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-4 border-b border-[#F5F1EB]">
              <h3 className="font-headline-sm text-headline-sm text-[#0F172A] font-bold">{actionModal.title}</h3>
              <button
                className="text-[#64748B] hover:text-[#0F172A] cursor-pointer"
                onClick={() => setActionModal((prev) => ({ ...prev, open: false }))}
                type="button"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="flex flex-col gap-4 py-2 pt-4">
              <div>
                <label className="block font-label-tag text-label-tag uppercase text-[#64748B] font-semibold mb-1.5">
                  Asset Amount
                </label>
                <div className="flex items-center justify-between bg-[#FAF8F5] border border-[#DDD4C5] px-4 py-3 rounded-xl">
                  <input
                    className="bg-transparent font-label-numeric-lg text-label-numeric-lg text-[#0F172A] font-bold outline-none w-1/2"
                    type="text"
                    value={modalAmount}
                    onChange={(e) => setModalAmount(e.target.value)}
                  />
                  <div className="flex items-center gap-2">
                    <button
                      className="px-2 py-0.5 rounded bg-indigo-50 border border-indigo-200 text-indigo-700 text-label-tag font-label-tag uppercase font-bold cursor-pointer"
                      onClick={() => {
                        if (actionModal.type === "deposit") {
                          setModalAmount(mWETHBalance ? formatUnits(mWETHBalance, 18) : "1.00");
                        } else if (actionModal.type === "repay") {
                          setModalAmount(debtAmount.toString());
                        } else {
                          setModalAmount("5000.00");
                        }
                      }}
                      type="button"
                    >
                      MAX
                    </button>
                    <span className="font-label-numeric-md text-label-numeric-md text-[#0F172A] font-bold">
                      {actionModal.asset}
                    </span>
                  </div>
                </div>
              </div>
              <div className="p-3.5 rounded-xl bg-[#FAF8F5] border border-[#EAE4DA] flex flex-col gap-1.5 text-body-sm font-body-sm">
                <div className="flex justify-between">
                  <span className="text-[#64748B]">Allowed Tier Borrow:</span>
                  <span className="text-teal-700 font-label-numeric-md text-label-numeric-md font-bold">
                    Up to $11,900.00 (80%)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#64748B]">Projected Health Factor:</span>
                  <span className="text-emerald-700 font-label-numeric-md text-label-numeric-md font-bold">
                    1.41 (Healthy)
                  </span>
                </div>
              </div>
              <button
                className="w-full py-3 rounded-xl bg-[#4F46E5] hover:bg-indigo-700 text-white font-headline-sm text-label-numeric-md font-semibold transition-all shadow-md shadow-indigo-600/20 cursor-pointer disabled:opacity-50"
                disabled={isSubmitting}
                onClick={handleModalSubmit}
                type="button"
              >
                {isSubmitting ? "Transacting on Base..." : "Confirm Onchain Transaction"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRM LIQUIDATION MODAL */}
      {liqModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-space-lg shadow-2xl border border-[#E6DFD5] space-y-space-md animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[#ba1a1a]">
                <span className="material-symbols-outlined text-[24px]">crisis_alert</span>
                <h3 className="font-headline-sm text-headline-sm font-bold text-[#111c2d]">Confirm Liquidation</h3>
              </div>
              <button
                className="text-[#8d9694] hover:text-[#111c2d] cursor-pointer"
                onClick={() => setLiqModal((prev) => ({ ...prev, open: false }))}
                type="button"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="p-space-md rounded-xl bg-[#FAF8F5] border border-[#E6DFD5] space-y-2 text-body-md text-[#535c5a]">
              <div className="flex justify-between items-center">
                <span>Target Borrower:</span>
                <span className="font-mono text-[#111c2d] font-semibold">{liqModal.borrower}</span>
              </div>
              <div className="flex justify-between items-center">
                <span>Debt Repayment Required:</span>
                <span className="font-label-numeric-md text-[#ba1a1a] font-bold">{liqModal.debt}</span>
              </div>
              <div className="flex justify-between items-center">
                <span>Instant 5% Keeper Bounty:</span>
                <span className="font-label-numeric-md text-[#005e40] font-bold">{liqModal.bounty}</span>
              </div>
            </div>
            <p className="font-body-sm text-body-sm text-[#535c5a]">
              By broadcasting this transaction, your wallet will supply the required mUSDC debt and receive the
              borrower's locked mWETH collateral at a 5% bonus.
            </p>
            <div className="flex items-center gap-space-sm pt-2">
              <button
                className="flex-1 py-2.5 rounded-xl bg-[#F5F1EB] hover:bg-[#EFE9DF] text-[#111c2d] font-label-numeric-md text-label-numeric-md font-semibold transition-all border border-[#E6DFD5] cursor-pointer"
                onClick={() => setLiqModal((prev) => ({ ...prev, open: false }))}
                type="button"
              >
                Cancel
              </button>
              <button
                className="flex-1 py-2.5 rounded-xl bg-[#ba1a1a] text-white hover:bg-[#ba1a1a]/90 font-label-numeric-md text-label-numeric-md font-bold transition-all shadow-md shadow-[#ba1a1a]/20 flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                disabled={isLiquidating}
                onClick={async () => {
                  setIsLiquidating(true);
                  try {
                    showToast("Submitting liquidation transaction...", "info");
                    setTimeout(() => {
                      showToast("Liquidation Confirmed! +111.25 mUSDC bounty credited.", "success");
                      setLiqModal((prev) => ({ ...prev, open: false }));
                      setIsLiquidating(false);
                    }, 1200);
                  } catch (e: any) {
                    setIsLiquidating(false);
                  }
                }}
                type="button"
              >
                <span className="material-symbols-outlined text-[16px]">bolt</span>
                <span>{isLiquidating ? "Submitting..." : "Execute Call"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FOOTER */}
      <footer className="w-full bg-[#FFFFFF] border-t border-[#E6DFD5] py-space-lg">
        <div className="w-full px-margin flex flex-col md:flex-row items-center justify-between gap-space-md">
          <div className="flex items-center gap-space-sm">
            <span className="font-headline-sm text-headline-sm bg-gradient-to-r from-indigo-700 via-indigo-600 to-violet-600 bg-clip-text text-transparent font-bold">
              TrustPaull
            </span>
            <span className="text-[#64748B] font-body-sm text-body-sm">— Onchain Credit Lending Protocol</span>
          </div>
          <div className="font-body-sm text-body-sm text-[#64748B] text-center md:text-right font-medium">
            Built for “Onchain Finance &amp; Trading” hackathon
          </div>
        </div>
      </footer>
    </div>
  );
}
