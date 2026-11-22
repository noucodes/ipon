package expo.modules.walletshortcuts

/**
 * Recognises money movements in e-wallet / bank notifications and SMS alerts.
 * Mirrors shared/src/detect.js (which has the unit tests) — keep the two in sync.
 */
object MoneyParser {
  data class Result(val source: String, val type: String, val amountCents: Long)

  private val ic = setOf(RegexOption.IGNORE_CASE)

  private val packageSources = mapOf(
    "com.globe.gcash.android" to "GCash",
    "com.paymaya" to "Maya",
  )

  private val nameSources = listOf(
    "GCash" to Regex("\\bg-?cash\\b", ic),
    "Maya" to Regex("\\b(pay)?maya\\b", ic),
    "BDO" to Regex("\\bbdo\\b", ic),
    "BPI" to Regex("\\bbpi\\b", ic),
    "UnionBank" to Regex("\\bunion ?bank\\b", ic),
    "Metrobank" to Regex("\\bmetro ?bank\\b", ic),
    "Security Bank" to Regex("\\bsecurity ?bank\\b", ic),
    "Landbank" to Regex("\\bland ?bank\\b", ic),
    "PNB" to Regex("\\bpnb\\b", ic),
    "RCBC" to Regex("\\brcbc\\b", ic),
    "China Bank" to Regex("\\bchina ?bank\\b", ic),
    "SeaBank" to Regex("\\bsea ?bank\\b", ic),
    "GoTyme" to Regex("\\bgo ?tyme\\b", ic),
    "CIMB" to Regex("\\bcimb\\b", ic),
    "Tonik" to Regex("\\btonik\\b", ic),
    "ShopeePay" to Regex("\\bshopee ?pay\\b", ic),
    "GrabPay" to Regex("\\bgrab ?pay\\b", ic),
  )

  private val amount = Regex("(?:₱|\\bPHP|\\bPhp|\\bP)\\s?((?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d{1,2})?)")
  private val skip = Regex("\\b(otp|one[- ]time|verification code|passcode|do not share|promo|win |raffle|available balance is|your balance is)\\b", ic)
  private val income = Regex("\\b(received|receive|sent you|credited|cash[- ]?in|deposited|deposit|refund(ed)?|incoming|added to your)\\b", ic)
  private val expense = Regex("\\b(sent|paid|payment|purchase[d]?|debited|transferred|withdr[ae]w[nl]?|withdrawal|cash[- ]?out|charged|spent|bought|bills? pay)\\b", ic)

  fun parse(packageName: String, text: String): Result? {
    if (text.isBlank() || skip.containsMatchIn(text)) return null
    val source = packageSources[packageName]
      ?: nameSources.firstOrNull { it.second.containsMatchIn(text) }?.first
      ?: return null
    val match = amount.find(text) ?: return null
    val value = match.groupValues[1].replace(",", "").toDoubleOrNull() ?: return null
    val cents = Math.round(value * 100)
    if (cents <= 0) return null
    val type = when {
      income.containsMatchIn(text) -> "income"
      expense.containsMatchIn(text) -> "expense"
      else -> return null
    }
    return Result(source, type, cents)
  }
}
