"use client";

import { createContext, useContext } from "react";

/**
 * Whether this form charges for orders from its Products questions
 * (a payment set up to charge the order total, on a plan with payments).
 * When it doesn't, the order is still recorded, and both the creator and
 * the respondent are told nothing is charged (QA FC4-08). Defaults to
 * true, so previews and other places without the setting show no note.
 */
const OrdersChargedContext = createContext(true);

export function OrdersChargedProvider({
  value,
  children,
}: {
  value: boolean;
  children: React.ReactNode;
}) {
  return (
    <OrdersChargedContext.Provider value={value}>
      {children}
    </OrdersChargedContext.Provider>
  );
}

export function useOrdersCharged(): boolean {
  return useContext(OrdersChargedContext);
}
