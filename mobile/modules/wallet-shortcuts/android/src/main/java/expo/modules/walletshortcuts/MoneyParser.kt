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
    "MariBank" to Regex("\\bmari ?bank\\b", ic),
    "GoTyme" to Regex("\\bgo ?tyme\\b", ic),
    "CIMB" to Regex("\\bcimb\\b", ic),
    "Tonik" to Regex("\\btonik\\b", ic),
    "ShopeePay" to Regex("\\bshopee ?pay\\b", ic),
    "GrabPay" to Regex("\\bgrab ?pay\\b", ic),
  )

  // Lenders / buy-now-pay-later: their alerts are loan payments, never income.
  private val lenders = listOf(
    "MariBank Credit" to Regex("\\bmari ?(?:bank )?credit\\b", ic), // before the plain MariBank bank
    "BillEase" to Regex("\\bbill ?ease\\b", ic),
    "SPayLater" to Regex("\\bs ?pay ?later\\b", ic),
    "GGives" to Regex("\\bg ?gives\\b", ic),
    "GLoan" to Regex("\\bg ?loan\\b", ic),
    "Atome" to Regex("\\batome\\b", ic),
    "Home Credit" to Regex("\\bhome ?credit\\b", ic),
    "Tala" to Regex("\\btala\\b", ic),
    "Cashalo" to Regex("\\bcashalo\\b", ic),
    "Juanhand" to Regex("\\bjuan ?hand\\b", ic),
  )
  private val loanPaid = Regex("\\b(payment|paid|repayment|posted)\\b", ic)
  private val loanNotYet = Regex("\\b(due|reminder|overdue|upcoming|avoid|late fee|will be)\\b", ic)

  // Currency before the amount ("PHP 500.00", "₱500") or after it ("2,950.00 GCASH", "500.00 PHP")
  private val amount = Regex("(?:₱|\\bPHP|\\bPhp|\\bP)\\s?((?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d{1,2})?)")
  private val amountAfter = Regex("\\b((?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d{1,2})?)\\s?(?:PHP|Php|php|GCASH|GCash|pesos?)\\b")

  /** First peso amount in the text, in centavos (0 if none). */
  private fun findAmount(text: String): Long {
    val a = amount.find(text)
    val b = amountAfter.find(text)
    val m = when {
      a != null && b != null -> if (a.range.first <= b.range.first) a else b
      else -> a ?: b
    } ?: return 0
    val v = m.groupValues[1].replace(",", "").toDoubleOrNull() ?: return 0
    return Math.round(v * 100)
  }
  private val skip = Regex("\\b(otp|one[- ]time|verification code|passcode|do not share|promo|win |raffle|available balance is|your balance is)\\b", ic)
  private val income = Regex("\\b(received|receive|sent you|credited|cash[- ]?in|deposited|deposit|refund(ed)?|incoming|added to your)\\b", ic)
  private val expense = Regex("\\b(sent|paid|payment|purchase[d]?|debited|transferred|withdr[ae]w[nl]?|withdrawal|cash[- ]?out|charged|spent|bought|bills? pay)\\b", ic)

  fun parse(packageName: String, text: String): Result? {
    if (text.isBlank() || skip.containsMatchIn(text)) return null

    val lender = lenders.firstOrNull { it.second.containsMatchIn(text) }?.first
    if (lender != null) {
      if (!loanPaid.containsMatchIn(text) || loanNotYet.containsMatchIn(text)) return null
      val c = findAmount(text)
      return if (c > 0) Result(lender, "loan_payment", c) else null
    }

    val source = packageSources[packageName]
      ?: nameSources.firstOrNull { it.second.containsMatchIn(text) }?.first
      ?: return null
    val cents = findAmount(text)
    if (cents <= 0) return null
    val type = when {
      income.containsMatchIn(text) -> "income"
      expense.containsMatchIn(text) -> "expense"
      else -> return null
    }
    return Result(source, type, cents)
  }
}
