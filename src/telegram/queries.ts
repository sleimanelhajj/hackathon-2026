import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

/** Telegram status; checks every few seconds while a read is running so progress shows without a reload. */
export const useTelegramStatus = () =>
  useQuery({
    queryKey: ["telegram-status"],
    queryFn: api.telegramStatus,
    refetchInterval: (q) => (q.state.data?.status === "syncing" ? 3000 : false),
  });

export const TELEGRAM_KEYS = [["telegram-status"], ["telegram-chats"], ["telegram-messages"]] as const;
