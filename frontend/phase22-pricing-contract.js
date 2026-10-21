export function pricingContract(rateListId, explicitRateText = null) {
  return {
    rateListId: rateListId || null,
    explicitRateText: explicitRateText ? String(explicitRateText).trim() : null,
    resolutionAuthority: "backend",
    allowClientInventedRate: false
  };
}
