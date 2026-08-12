/**
 * WalkChamp Terms and Conditions — structured content.
 *
 * DRAFT – LEGAL REVIEW REQUIRED BEFORE PUBLICATION
 * This notice is for internal engineering/legal use only.
 * Do not render it in the user-facing UI after legal approval.
 *
 * CIN: insert the verified Corporate Identification Number before publication.
 * Do not invent or display a placeholder CIN to end users.
 */

export type TermsSection = {
  id: string;
  number: number;
  title: string;
  body: string;
  keywords: string[];
};

export type TermsDocument = {
  version: string;
  effectiveDate: string;
  title: string;
  lastUpdatedLabel: string;
  intro: string;
  supportEmail: string;
  publicUrl: string;
  sections: TermsSection[];
};

export const TERMS_SUPPORT_EMAIL = "admin@miragaming.com";
export const TERMS_PUBLIC_URL = "https://walkchamp.app/terms";

export const TERMS_DOCUMENT: TermsDocument = {
  version: "1.0",
  effectiveDate: "2026-07-21",
  title: "WalkChamp Terms and Conditions",
  lastUpdatedLabel: "July 21, 2026",
  intro: "Please read these Terms and Conditions carefully before accessing or using WalkChamp. These Terms explain your legal rights and responsibilities, challenge participation rules, financial risks, payment and payout conditions, health-data requirements, prohibited conduct, refund rules, account restrictions, and dispute procedures.",
  supportEmail: TERMS_SUPPORT_EMAIL,
  publicUrl: TERMS_PUBLIC_URL,
  sections: [
    {
      id: "interpretation-definitions",
      number: 1,
      title: "Interpretation and Definitions",
      keywords: ["definitions","account","coins","wallet","verified steps","prize pool"],
      body: `1.1 Interpretation

Words with initial capital letters have the meanings provided below. These definitions apply whether the words are used in singular or plural form.

1.2 Definitions

Account means the user account created to access WalkChamp.

Active Race means a Challenge that has started and has not yet ended, been cancelled, forfeited, or finally settled.

Application, App, or WalkChamp means the WalkChamp mobile application and related services provided by MIRA GAMING PRIVATE LIMITED.

Application Store means the Apple App Store, Google Play Store, or another authorized platform from which WalkChamp is downloaded.

Cash Balance means verified money recorded in the Wallet and specifically designated as eligible for withdrawal, subject to identity verification, fraud review, geographic availability, minimum withdrawal limits, provider requirements, and applicable law.

Cash Challenge or Cash Prize Challenge means a skill-based walking competition in which eligible participants pay the disclosed Cash Entry Contribution and may earn a cash prize based on Verified Steps, completion time, ranking, and the applicable Challenge Rules.

Cash Entry Contribution means the amount contributed by a participant to the Prize Pool for a Cash Prize Challenge.

Challenge means a Free Challenge, Coins Battle, Cash Prize Challenge, Sponsored Event, public challenge, private challenge, scheduled race, group challenge, or another supported walking or fitness competition.

Challenge Rules means the specific conditions displayed in WalkChamp for an individual Challenge, including challenge type, start time, end time, step target, participant capacity, entry requirements, Fees, Prize Pool, reward, winner structure, refund rules, withdrawal rules, and eligibility restrictions.

Coins means virtual, app-only units that may be earned, purchased where permitted, awarded, or used inside WalkChamp. Coins are not money, legal tender, deposits, securities, or cryptocurrency. Coins have no guaranteed cash value and are not withdrawable unless WalkChamp expressly states otherwise in a legally permitted offer.

Company, Mira Gaming, we, us, and our mean MIRA GAMING PRIVATE LIMITED.

Entry Amount means the Cash Entry Contribution or other challenge entry requirement displayed before registration.

Fees means any separately disclosed processing fee, platform fee, service fee, convenience fee, tax, payment-provider charge, or other fee payable in addition to the Cash Entry Contribution.

Health Data Provider means Apple Health, Apple HealthKit, Google Health Connect, an approved device sensor, or another supported source used by WalkChamp to obtain or validate health and fitness activity.

IANA Timezone means a standardized timezone identifier used to display and synchronize Challenge dates and times.

Live Board means the complete or expanded participant ranking for a live Challenge.

Official Timestamp means a backend-recorded timestamp used to determine registration, start time, end time, goal completion, ranking, and settlement.

Participant means a User whose Challenge registration has been confirmed by the WalkChamp backend.

Platform Fee means a separately disclosed service charge payable to WalkChamp where applicable.

Prize Pool means the total amount designated for distribution to eligible winners of a Cash Prize Challenge or Sponsored Event.

Processing Fee means a separately disclosed payment-processing charge.

Promotional Credit means a bonus, referral reward, coupon, credit, or promotional balance issued under specific offer terms.

Race Track means the visual race representation that may display only a limited number or selected subset of participants.

Service means the WalkChamp application, backend services, websites, APIs, Wallet, Challenges, social features, communications, and related services operated by Mira Gaming.

Spectator means a User who watches a Challenge without being registered as a Participant.

Sponsored Event means a Challenge funded, organized, supported, or promoted by Mira Gaming or an approved sponsor.

Upcoming Challenge means a successfully registered Challenge with an Official Timestamp in the future.

Verified Steps means steps accepted by WalkChamp after applying Challenge timestamps, provider information, duplicate prevention, source validation, anti-cheat checks, synchronization rules, and other verification methods.

Wallet means the in-app record of Cash Balance, Coins, Promotional Credit, Entry Amounts, refunds, rewards, payouts, and transaction history.

You, your, or User means the individual accessing or using WalkChamp.`,
    },
    {
      id: "acceptance",
      number: 2,
      title: "Acceptance of These Terms",
      keywords: ["accept","agree","privacy policy","challenge rules"],
      body: `By creating an Account, downloading, registering for, accessing, or using WalkChamp, you agree to:

• These Terms and Conditions
• The WalkChamp Privacy Policy
• Challenge Rules displayed before registration
• Refund conditions
• Fair Play and Anti-Cheat rules
• Community Guidelines
• Sponsored Event rules
• Referral and promotional terms
• Payment and payout conditions
• Any additional terms displayed before confirming a transaction

If there is a conflict between these Terms and the specific Challenge Rules, the Challenge Rules control only for that Challenge where they were clearly displayed before registration and are legally enforceable.

Nothing in these Terms removes any mandatory consumer right that cannot legally be waived.`,
    },
    {
      id: "eligibility-age-geography",
      number: 3,
      title: "Eligibility, Age, and Geographic Availability",
      keywords: ["age","18","location","vpn","eligibility","geographic"],
      body: `You must be at least 18 years old, or the higher legal age required in your location, to participate in:

• Cash Prize Challenges
• Paid Challenges
• Cash rewards
• Gift-card rewards
• Withdrawals
• Financial transactions
• Payout-enabled promotions

Free and non-cash features may be available more broadly, subject to applicable age, safety, and account rules.

Cash Prize Challenges are available only in countries, states, territories, or regions where Mira Gaming has enabled the feature and where participation is lawful.

Availability depends on factors including:

• Physical location
• Account country
• State or province
• Age
• Identity-verification status
• Payment-provider availability
• Payout-provider availability
• App-store policy
• Applicable law
• KYC or compliance requirements

Availability in the Application does not override the laws of your location.

You must provide accurate information when requested, including:

• Name
• Age
• Date of birth
• Country
• State or province
• Physical location
• Timezone
• Payment information
• Payout information
• Tax information
• Identity information

Mira Gaming may use IP address, device information, location permission, Account information, transaction information, and payment signals to enforce eligibility and prevent fraud.

You must not use:

• VPN services
• Proxy services
• GPS spoofing
• Device-location manipulation
• False identity information
• False residency information

to bypass geographic or legal restrictions.

Employees, directors, officers, contractors, and household members of Mira Gaming may be excluded from prize-bearing Challenges except for approved internal testing.`,
    },
    {
      id: "accounts-devices-security",
      number: 4,
      title: "Accounts, Devices, and Security",
      keywords: ["account","password","security","duplicate"],
      body: `You may maintain only one Account unless Mira Gaming provides written permission.

You must not:

• Share your Account
• Sell your Account
• Transfer your Account
• Allow another person to participate for you
• Allow another person to generate steps for you
• Create duplicate Accounts
• Use another User's Account

WalkChamp may limit simultaneous sessions.

Logging in on a new device may terminate or invalidate a previous session.

You are responsible for:

• Protecting your password
• Protecting your phone
• Maintaining accurate profile details
• Maintaining accurate payment details
• Maintaining accurate payout details
• Reporting unauthorized access

Contact admin@miragaming.com if you believe your Account has been compromised.

Mira Gaming may require verification of:

• Email
• Phone number
• Device
• Identity
• Payment method
• Payout method
• Country
• Age
• Tax status`,
    },
    {
      id: "communications-permissions",
      number: 5,
      title: "Communications and Permissions",
      keywords: ["notifications","permissions","apple health","health connect","microphone"],
      body: `By creating an Account, you agree to receive necessary transactional communications, including:

• Registration confirmations
• Challenge reminders
• Race-start alerts
• Waiting Room updates
• Results
• Wallet transactions
• Payment updates
• Refund updates
• Payout updates
• Security alerts
• Rule changes
• Account notices

Communications may be delivered through:

• Email
• Push notification
• In-app notification
• Other supported electronic methods

Marketing communications are optional and may be disabled where settings or unsubscribe options are provided.

Disabling notifications may cause you to miss reminders, but it does not change the official start or end time of a Challenge.

WalkChamp may request permission to access:

• Apple Health
• Health Connect
• Motion or activity data
• Location
• Microphone
• Camera
• Photo library
• Push notifications

Some permissions are optional. However, permissions required to verify steps or operate a Challenge may be necessary before registration or participation.`,
    },
    {
      id: "nature-of-walk-champ",
      number: 6,
      title: "Nature of WalkChamp",
      keywords: ["skill","financial risk","gambling","verified steps"],
      body: `WalkChamp is a walking, fitness, social, and skill-based competition platform.

Challenge outcomes are intended to depend on:

• Verified physical activity
• Step performance
• Goal completion
• Completion time
• Ranking criteria
• Compliance with Challenge Rules

Challenge outcomes are not intended to be based on random chance.

However, legal classification varies across jurisdictions.

Mira Gaming may restrict, suspend, change, or discontinue Cash Prize Challenges in any region based on:

• Applicable law
• Legal advice
• Licensing requirements
• Payment-provider requirements
• Payout-provider requirements
• Apple App Store rules
• Google Play rules

Financial Risk Acknowledgment:

You may lose the full Entry Amount and any non-refundable Fees.

There is no guarantee that you will:

• Complete the target
• Win a Challenge
• Receive a prize
• Recover the Entry Amount
• Qualify for a payout

Participate only using money you can afford to lose.`,
    },
    {
      id: "challenge-types",
      number: 7,
      title: "Challenge Types",
      keywords: ["free","coins battle","cash","sponsored","private","public","scheduled","entry fee","processing fee","platform fee"],
      body: `7.1 Free Challenges

Free Challenges do not require a cash or Coin entry.

They may provide:

• Rankings
• Coins
• Badges
• Achievements
• Titles
• Sponsor rewards
• Recognition
• Other displayed non-cash benefits

7.2 Coins Battles

Coins Battles require the displayed number of Coins.

Coins may be deducted:

• When registration is confirmed
• When the Challenge starts
• At another clearly disclosed time

The Application displays:

• Coin entry
• Coin Prize Pool
• Step goal
• Participant count
• Winner structure
• Refund rules

Coins are virtual and generally cannot be withdrawn as cash.

7.3 Cash Prize Challenges

Cash Prize Challenges require a Cash Entry Contribution.

Processing Fees and Platform Fees are separate from the Cash Entry Contribution where applicable.

The confirmation screen must display:

• Cash Entry Contribution
• Processing Fee
• Platform Fee
• Applicable tax
• Total payable amount
• Estimated Prize Pool
• Winner structure
• Refund conditions

Supported entry tiers may include:

• USD 3
• USD 5
• USD 10
• USD 15
• USD 20
• USD 25

or configured local-currency equivalents.

The backend and final confirmation screen are authoritative.

7.4 Sponsored Events

Sponsored Events may:

• Be free
• Require Coins
• Require invitation
• Have geographic restrictions
• Have sponsor-specific conditions

Rewards may include:

• Coins
• Cash
• Gift cards
• Coupons
• Products
• Badges
• Titles
• Recognition
• Other disclosed benefits

7.5 Public Challenges

Public Challenges may be discoverable by eligible Users and may be subject to geographic, participant, payment, and eligibility restrictions.

7.6 Private Challenges

Private Challenges may require:

• Invitation
• Valid room code
• Direct approval

Private Challenges may be Free, Coins, or Cash where legally supported.

7.7 Scheduled Challenges

Scheduled Challenges have a future Official Timestamp.

They may begin automatically at the scheduled time unless cancelled or otherwise modified according to the Challenge Rules.`,
    },
    {
      id: "registration-participation-limits",
      number: 8,
      title: "Registration and Participation Limits",
      keywords: ["registration","spectator","sponsored event","one active"],
      body: `Registration is complete only when the WalkChamp backend confirms:

• Eligibility
• Participant capacity
• Payment
• Coin deduction
• Challenge status
• Required permissions
• Geographic eligibility
• Account status

A visible frontend confirmation that has not been validated by the backend does not guarantee registration.

Watching a Challenge does not make you a Participant.

Spectators do not receive Participant rights, rankings, prizes, or registration benefits.

Mira Gaming may reject or reverse a registration caused by:

• Duplicate request
• Insufficient balance
• Invalid payment
• Restricted location
• Participant-limit conflict
• Closed registration
• Technical error
• Suspicious activity
• Fraud signal

Sponsored Event restriction:

A User may be registered for only one active or upcoming Sponsored Event at a time.

To register for another Sponsored Event, the User must either:

• Leave the current Sponsored Event before it starts where withdrawal is permitted; or
• Wait until the current Sponsored Event has completed

Limits on simultaneous Free, Coins, and Cash Challenges are determined by the rules displayed in WalkChamp.

WalkChamp may permit an ongoing Challenge and a future scheduled Challenge to coexist where supported.`,
    },
    {
      id: "schedules-waiting-rooms-timezones",
      number: 9,
      title: "Challenge Schedules, Waiting Rooms, and Timezones",
      keywords: ["waiting room","timezone","countdown","official timestamp"],
      body: `Every Challenge uses backend-provided start and end timestamps.

These backend timestamps are authoritative.

Device clock settings do not change the official Challenge period.

The Application may display times using your:

• Local timezone
• Device locale
• IANA timezone

Only Verified Steps recorded inside the official Challenge start and end window count toward that Challenge.

Steps recorded outside the Challenge window may still appear in daily or lifetime totals but do not count toward that Challenge.

You do not need to remain inside the Waiting Room.

A scheduled Challenge may start automatically.

The Waiting Room may display:

• Countdown
• Start time
• Host
• Registered Participants
• Participant slots
• Step goal
• Entry information
• Prize Pool
• Reward
• Room ID
• Online status

The host should appear in the first occupied slot.

Confirmed Participants may appear in the Waiting Room as soon as their registration is completed.

A green presence indicator may mean online.

A gray indicator may mean offline or unavailable presence status.

Presence information is informational and may be delayed.

Travel, daylight-saving changes, device timezone changes, incorrect clocks, offline use, or provider delays may affect what is displayed.

Backend timestamps and accepted provider timestamps control the Challenge.`,
    },
    {
      id: "cash-pricing-fees-prize-pools",
      number: 10,
      title: "Cash Challenge Pricing, Fees, and Prize Pools",
      keywords: ["processing fee","platform fee","prize pool","entry contribution","total payable"],
      body: `Before a User confirms entry into a Cash Prize Challenge, WalkChamp must display:

• Cash Entry Contribution
• Processing Fee
• Platform Fee
• Tax where applicable
• Total payable amount
• Estimated or final Prize Pool
• Current participant count
• Winner structure
• Withdrawal conditions
• Refund conditions

The Cash Entry Contribution is allocated toward the Prize Pool.

Processing Fees are separate from the Cash Entry Contribution.

Platform Fees are separate from the Cash Entry Contribution.

Taxes and provider charges may also be separate.

Mira Gaming will not secretly reduce a displayed Prize Pool.

Any deduction affecting the Prize Pool must be clearly disclosed before registration.

The Prize Pool may change before the Challenge locks when:

• Participants join
• Participants validly withdraw
• Payments fail
• Refunds are issued
• Registrations are reversed
• Participants are removed before start

All monetary amounts should be calculated using the smallest currency unit, such as cents or paise.

Example:

100 confirmed Participants × USD 3 Cash Entry Contribution = USD 300 Prize Pool.

Separately disclosed Processing Fees, Platform Fees, taxes, and provider charges are not included in that calculation unless explicitly stated.`,
    },
    {
      id: "winner-determination-prize-distribution",
      number: 11,
      title: "Winner Determination and Prize Distribution",
      keywords: ["winner","prize","tie-break","distribution","50%","60%"],
      body: `Winner eligibility is determined by the WalkChamp backend using:

• Verified Steps
• Challenge target
• Goal-completion timestamp
• Participant status
• Challenge status
• Challenge Rules
• Anti-cheat checks
• Withdrawal status
• Forfeit status
• Disqualification status
• Geographic eligibility
• Payment status

Frontend ranks, progress bars, estimates, and Prize Pool displays may be provisional.

The backend settlement record controls the final result.

Winner count and percentage distribution may change based on the final eligible Participant count.

The exact winner structure must be displayed before registration and locked when the Challenge begins.

For specifically configured small Challenges, WalkChamp may use:

• 2 Participants: 1 winner receiving 100%
• 3 Participants: 2 winners receiving 60% and 40%
• 4 to 10 Participants: 3 winners receiving 50%, 30%, and 20%

This structure must not automatically be applied to Challenges with more than 10 Participants unless it was displayed before entry.

For Challenges supporting 11 to 100 Participants:

• The number of winners may increase
• The Prize Pool may be distributed across more positions
• The exact percentages must be shown before registration
• The structure must be locked before the Challenge begins

Ranking may use the earliest verified goal-completion timestamp.

If two Participants have exactly the same accepted timestamp, the disclosed tie-break rule applies.

Participants who withdraw, forfeit, are disqualified, or otherwise become ineligible do not receive a prize.

A displayed estimated prize is not a final award.

Prizes are credited only after:

• Challenge completion
• Result verification
• Anti-cheat review
• Payment review
• Identity review where required
• Geographic review
• Compliance review`,
    },
    {
      id: "sponsored-event-rewards",
      number: 12,
      title: "Sponsored Event Rewards",
      keywords: ["sponsored event","gift card","coins refund"],
      body: `Sponsored Event rewards are governed by the rules displayed for that event.

Only Verified Steps recorded within the event start and end timestamps count.

Completing the target does not guarantee a reward unless the event rules state that every eligible finisher receives one.

Where a Sponsored Event requires Coins:

• Coins may be deducted at registration
• Leaving before the event starts may allow one refund where shown
• After the event starts, the Coin entry may be non-refundable

Rewards may be subject to:

• Stock availability
• Sponsor conditions
• Country restrictions
• Age restrictions
• Verification
• Delivery requirements
• Applicable law

Gift cards, products, coupons, and other sponsor rewards may have separate issuer rules and expiry dates.`,
    },
    {
      id: "coins-virtual-items",
      number: 13,
      title: "Coins and Virtual Items",
      keywords: ["coins","virtual","withdraw","in-app purchase"],
      body: `Coins and virtual items are limited licenses to use supported features.

Coins are not:

• Legal tender
• Cash
• Bank deposits
• Securities
• Cryptocurrency
• Stored-value accounts
• Insured funds

Coins do not earn interest.

Coins cannot normally be:

• Withdrawn
• Sold
• Transferred outside WalkChamp
• Exchanged for cash
• Redeemed for gift cards

unless a specific legally permitted promotion expressly states otherwise.

Coin balances may be corrected for:

• Errors
• Duplicate awards
• Refunds
• Reversals
• Chargebacks
• Fraud
• Violations
• Failed purchases

Purchased Coins or digital items may be subject to Apple or Google in-app purchase and refund rules.`,
    },
    {
      id: "referral-program",
      number: 14,
      title: "Referral Program",
      keywords: ["referral","invite friends","self-referral"],
      body: `WalkChamp may offer referral programs.

The terms displayed in the Invite Friends screen control.

A referral reward may be:

• Coins
• Cash Balance
• Promotional Credit
• Coupon
• Other displayed benefit

A referred User may need to:

• Create a new Account
• Use the valid referral code
• Complete Account verification
• Join an eligible Challenge
• Complete a qualifying action
• Pass fraud and eligibility review

Pending referral rewards are not withdrawable.

Referral rewards may be cancelled or reversed for:

• Self-referral
• Duplicate Accounts
• Multiple-account abuse
• Shared-payment abuse
• Shared-device abuse
• Coordinated registrations
• Fraudulent transactions
• False identity information
• Promotion manipulation

The reward amount and qualifying conditions displayed in WalkChamp control.`,
    },
    {
      id: "wallet-cash-withdrawals",
      number: 15,
      title: "Wallet, Cash Balance, and Withdrawals",
      keywords: ["wallet","withdrawal","stripe","razorpay","kyc","cash balance"],
      body: `The WalkChamp Wallet is an internal ledger.

It is not:

• A bank account
• A savings account
• A deposit account
• An insured financial product

Balances do not earn interest.

Wallet balances may include:

• Withdrawable Cash Balance
• Coins
• Promotional Credit
• Pending rewards
• Refunds
• Cash Entry Contributions
• Prizes
• Payouts
• Reversals

Only amounts marked as withdrawable Cash Balance may be withdrawn.

Coins are not withdrawable.

Promotional Credit may be non-withdrawable.

Withdrawals may require:

• Age verification
• Identity verification
• KYC verification
• Tax information
• Country verification
• Location verification
• Payout-name verification
• Fraud review
• Payment-method verification

WalkChamp may use providers such as:

• Stripe
• Razorpay
• Apple
• Google
• Other approved payment or payout providers

depending on the User's location and transaction type.

The minimum withdrawal is the amount displayed inside the Application.

Processing-time estimates are not guarantees.

Delays may occur due to:

• Provider review
• Bank processing
• Holidays
• Identity verification
• Compliance review
• Technical issues
• Incorrect payout information

Users are responsible for providing correct payout information.

Mira Gaming is not responsible for payments sent to incorrect details provided by a User, except where required by law.`,
    },
    {
      id: "challenge-withdrawals-refunds",
      number: 16,
      title: "Challenge Withdrawals and Refunds",
      keywords: ["refund","forfeit","withdrawal","cancellation"],
      body: `Refund and forfeiture rules depend on:

• Challenge type
• Timing
• Entry type
• Challenge status
• Provider rules
• Applicable law
• Rules displayed before registration

Before a Challenge starts:

• Withdrawal may be allowed
• Eligible Cash Entry Contributions may be returned
• Eligible Coins may be restored
• Processing Fees may be non-refundable
• Platform Fees may be non-refundable
• Taxes or provider charges may be non-refundable

unless WalkChamp or applicable law states otherwise.

After a Challenge starts:

• Leaving is generally considered a forfeit
• Cash Entry Contributions are generally non-refundable
• Fees are generally non-refundable
• The Participant becomes ineligible for prizes

If Mira Gaming or the host validly cancels a Challenge before start:

• Eligible Cash Entry Contributions may be returned
• Eligible Coins may be restored
• Refund handling follows provider rules and applicable law

Each qualifying cancellation or withdrawal is entitled to only one refund.

Wallet transaction history should display refund status, amount, date, and time where supported.`,
    },
    {
      id: "step-tracking-health-data",
      number: 17,
      title: "Step Tracking and Health Data",
      keywords: ["apple health","health connect","verified steps","manual steps"],
      body: `WalkChamp may obtain activity data through:

• Apple Health on iOS
• Apple HealthKit
• Google Health Connect on Android
• Approved device sensors where supported
• Supported wearable applications that write information to Apple Health or Health Connect

Users must grant and maintain the permissions required for Challenge participation.

Daily Steps and Race Steps are different calculations.

Race Steps count only within the official Challenge window.

Steps may be excluded when they are:

• Manually entered
• Duplicated
• Simulated
• Generated through unauthorized sources
• Recorded outside the Challenge period
• Suspicious
• Altered
• Unsupported
• Delayed beyond required verification limits

Different devices and health platforms may display different totals.

Wearable applications may synchronize slowly.

Users should:

• Keep devices charged
• Keep required permissions enabled
• Maintain internet access
• Open WalkChamp periodically
• Confirm synchronization
• Check Challenge progress before the deadline

Switching devices, revoking permissions, uninstalling WalkChamp, disabling background processes, changing accounts, or relying on delayed wearable sync may reduce or interrupt accepted steps.

For Challenge results, the backend record of Verified Steps controls, subject to the dispute process.

Mira Gaming does not guarantee that every device, sensor, wearable, or health platform is perfectly accurate.

Health information is governed by the WalkChamp Privacy Policy.

Health information is not used for targeted advertising.`,
    },
    {
      id: "fair-play-anti-cheat",
      number: 18,
      title: "Fair Play and Anti-Cheat",
      keywords: ["cheat","disqualification","emulator","fraud","anti-cheat"],
      body: `All Challenge activity must be genuinely performed by the registered User.

Prohibited conduct includes:

• Shaking a phone or wearable
• Swinging or rotating a device to create false steps
• Mechanically moving a device
• Attaching a device to a vehicle
• Using pets to create activity
• Using machines to generate steps
• Scripts
• Automation
• Emulators
• Step generators
• Sensor spoofing
• GPS spoofing
• Location spoofing
• Modified operating systems
• Rooted or jailbroken manipulation
• Unauthorized third-party tools
• Manual step insertion
• Account sharing
• Using another person's activity
• Allowing another person to participate for you
• Multiple-account abuse
• Self-referrals
• Collusion
• Deliberate forfeiture to transfer value
• Payment manipulation
• Refund abuse
• Exploiting duplicate requests
• Exploiting bugs
• Exploiting synchronization errors
• Manipulating rankings
• Submitting false evidence
• Harassing Participants

Mira Gaming may review:

• Step rates
• Timestamps
• Movement consistency
• Device signals
• Data sources
• Duplicate records
• Impossible patterns
• Location information where permitted
• Payment behavior
• Referral relationships
• Account relationships
• Challenge behavior

Mira Gaming may:

• Remove invalid steps
• Correct results
• Hold rewards
• Request evidence
• Disqualify a Participant
• Reverse fraud-related rewards
• Block withdrawals
• Restrict an Account
• Suspend an Account
• Terminate an Account
• Report suspected unlawful activity

Fraud-detection thresholds and internal security methods are confidential.`,
    },
    {
      id: "results-leaderboards-disputes",
      number: 19,
      title: "Results, Leaderboards, and Disputes",
      keywords: ["dispute","leaderboard","results","seven days"],
      body: `Live leaderboards, countdowns, progress bars, Prize Pools, ranks, and participant counts may be delayed or provisional.

Final settlement occurs only after backend verification.

If you believe a final result is incorrect, contact:

admin@miragaming.com

within seven days after the Challenge ends, unless a longer period is required by law.

Include:

• Username
• Account email
• Challenge ID
• Room ID
• Relevant dates
• Device model
• Operating-system version
• Apple Health or Health Connect source
• Screenshots
• Relevant health-platform records
• Clear description of the issue

Mira Gaming will review available records in good faith.

WalkChamp cannot credit steps that never reached the authorized health platform.

Mandatory consumer rights remain unaffected.`,
    },
    {
      id: "user-content-social",
      number: 20,
      title: "User Content and Social Features",
      keywords: ["chat","voice","profile","user content"],
      body: `User Content may include:

• Profile photos
• Avatars
• Usernames
• Titles
• Messages
• Replies
• Reactions
• Cheers
• Group content
• Voice activity
• Reports
• Other submitted content

You retain ownership of content you submit.

You grant Mira Gaming a non-exclusive, worldwide, royalty-free license to host, store, reproduce, display, format, transmit, moderate, and use that content as necessary to operate and secure WalkChamp.

You must not submit content that is:

• Illegal
• Infringing
• Abusive
• Threatening
• Hateful
• Discriminatory
• Sexually explicit
• Graphically violent
• Fraudulent
• Deceptive
• Spam
• Malware
• Another person's private information

Mira Gaming may remove content and restrict or suspend Accounts.

Where available, Users may report or block other Users.

Mira Gaming is not required to pre-screen every communication.`,
    },
    {
      id: "code-of-conduct",
      number: 21,
      title: "WalkChamp Code of Conduct",
      keywords: ["conduct","harassment","community"],
      body: `Users must:

• Compete honestly
• Follow Challenge Rules
• Respect other Users
• Avoid harassment
• Avoid bullying
• Avoid body-shaming
• Avoid threats
• Avoid hate speech
• Avoid discrimination
• Avoid spam
• Avoid unrelated advertising
• Avoid harmful links
• Protect other Users' privacy
• Avoid impersonation
• Avoid false reports
• Avoid voice and chat abuse
• Avoid ranking manipulation
• Use WalkChamp safely while walking

Serious concerns may be reported to:

admin@miragaming.com`,
    },
    {
      id: "sponsored-content-third-party",
      number: 22,
      title: "Sponsored Content and Third-Party Offers",
      keywords: ["sponsor","advertisement","third-party"],
      body: `WalkChamp may display:

• Sponsorships
• Advertisements
• Coupons
• Third-party offers
• Links
• Sponsor rewards

Sponsored content will be identified where required.

Unless expressly stated, Mira Gaming does not guarantee third-party:

• Products
• Quality
• Safety
• Availability
• Fulfillment
• Redemption
• Privacy practices

Third-party terms may apply.

Apple and Google do not sponsor or provide WalkChamp Challenge rewards.`,
    },
    {
      id: "third-party-services",
      number: 23,
      title: "Third-Party Services",
      keywords: ["stripe","razorpay","descope","pusher","onesignal","livekit"],
      body: `WalkChamp may rely on third parties for:

• Authentication
• Cloud hosting
• Databases
• File storage
• Realtime communication
• Notifications
• Voice communication
• Payments
• Payouts
• Identity verification
• Health platforms
• Analytics
• Crash reporting
• Security
• App distribution

Services may include providers such as:

• Stripe
• Razorpay
• Apple
• Google
• Descope
• Neon
• Pusher
• OneSignal
• LiveKit
• Cloud-storage providers

Only providers actually enabled in production should be named in the final version.

Third-party services are subject to their own terms and privacy policies.

Mira Gaming is not responsible for third-party outages, payment decisions, account restrictions, or technical failures, except where required by law.`,
    },
    {
      id: "privacy-sensitive-data",
      number: 24,
      title: "Privacy and Sensitive Data",
      keywords: ["privacy","health data","sensitive"],
      body: `Use of WalkChamp is also governed by the WalkChamp Privacy Policy.

Sensitive information may include:

• Health information
• Identity information
• Financial information
• Location information
• Device information
• Communications

Mira Gaming does not sell individual-level health information.

Health information is not used for targeted advertising.

Health information is not shared for unrelated third-party artificial-intelligence training without separate, specific permission.

The Privacy Policy is available directly above Terms and Conditions in the Profile Legal section.`,
    },
    {
      id: "health-medical-disclaimer",
      number: 25,
      title: "Health and Medical Disclaimer",
      keywords: ["medical","health","injury","disclaimer"],
      body: `WalkChamp is a fitness and entertainment service.

WalkChamp is not:

• A healthcare provider
• A medical service
• An emergency service
• A diagnostic tool
• A treatment provider

Consult a qualified healthcare professional before beginning physical activity, especially if you:

• Have a medical condition
• Are pregnant
• Are recovering from an injury
• Take medication
• Have been advised to limit exercise

Stop activity and seek appropriate care if you experience:

• Pain
• Dizziness
• Faintness
• Shortness of breath
• Chest discomfort
• Other warning signs

No Challenge or reward is worth risking your health.

You voluntarily accept ordinary risks associated with walking and exercise, including:

• Falls
• Traffic hazards
• Weather
• Overexertion
• Injury

Do not use WalkChamp in a way that distracts you while:

• Driving
• Cycling
• Crossing roads
• Operating machinery
• Entering unsafe areas`,
    },
    {
      id: "taxes-reporting",
      number: 26,
      title: "Taxes and Reporting",
      keywords: ["tax","reporting","withholding"],
      body: `You are responsible for determining and paying taxes applicable to:

• Prizes
• Referral rewards
• Withdrawals
• Promotional rewards
• Other amounts received

Mira Gaming may:

• Request tax information
• Withhold amounts where required
• Issue tax forms
• Report transactions
• Maintain financial records

WalkChamp does not provide tax advice.

Consult a qualified tax professional.`,
    },
    {
      id: "chargebacks-payment-disputes",
      number: 27,
      title: "Chargebacks and Payment Disputes",
      keywords: ["chargeback","payment dispute"],
      body: `Where practical, contact admin@miragaming.com before initiating a chargeback so Mira Gaming can investigate.

This does not limit your legal right to dispute unauthorized or incorrect charges.

If a User initiates a fraudulent or improper chargeback, Mira Gaming may:

• Suspend the Account
• Reverse related Challenge entries
• Reverse related rewards
• Deduct directly connected amounts
• Prevent future participation
• Provide transaction records to the payment provider

Legitimate, unrelated Cash Balance will not be confiscated solely as punishment, except where necessary to offset fraud losses, duplicate credits, chargebacks, or legal obligations.`,
    },
    {
      id: "account-suspension-termination-deletion",
      number: 28,
      title: "Account Suspension, Termination, and Deletion",
      keywords: ["account deletion","suspend","terminate"],
      body: `You may request Account deletion:

• Through the in-app Delete Account feature
• By emailing admin@miragaming.com

Before deleting your Account:

• Withdraw eligible Cash Balance
• Resolve pending payouts
• Resolve active payment disputes
• Complete or leave active Challenges where required
• Save information you need

Deleting an Account during an active Challenge may result in forfeiture according to the displayed Challenge Rules.

Mira Gaming may restrict, suspend, or terminate Accounts for:

• Fraud
• Cheating
• Multiple Accounts
• Chargeback abuse
• Payment abuse
• Unlawful location
• Harassment
• Security risk
• Failed verification
• Legal requirements
• Material violations of these Terms

Some records may be retained after deletion as described in the Privacy Policy.`,
    },
    {
      id: "service-availability-changes",
      number: 29,
      title: "Service Availability and Changes",
      keywords: ["as available","outage","cancel challenge"],
      body: `WalkChamp is provided on an "as available" basis.

The Service may be interrupted, delayed, restricted, changed, or discontinued due to:

• Maintenance
• Security
• Capacity
• Applicable law
• App-store rules
• Provider outages
• Device limitations
• Internet failures
• Force majeure
• Payment issues
• Health-platform issues

If a Challenge is materially affected, Mira Gaming may reasonably:

• Extend the Challenge
• Cancel the Challenge
• Refund eligible entries
• Restore eligible Coins
• Void affected data
• Settle using the best available Verified Steps
• Apply another fair remedy

Any remedy remains subject to applicable law.`,
    },
    {
      id: "intellectual-property",
      number: 30,
      title: "Intellectual Property",
      keywords: ["copyright","trademark","license","reverse engineer"],
      body: `The following are owned by or licensed to Mira Gaming:

• WalkChamp name
• Logos
• Application code
• Designs
• Graphics
• Race Tracks
• Themes
• Icons
• Animations
• Audio
• Documentation
• Challenge content
• Backend systems
• Other intellectual property

You receive a limited, personal, revocable, non-exclusive, non-transferable license to use WalkChamp for its intended purpose.

You must not:

• Copy
• Reverse engineer
• Scrape
• Sell
• Sublicense
• Modify
• Distribute
• Create derivative works
• Commercially exploit

WalkChamp except where permitted by law or written authorization.`,
    },
    {
      id: "apple-app-store-terms",
      number: 31,
      title: "Apple App Store Terms",
      keywords: ["apple","app store","healthkit"],
      body: `These Terms are between you and MIRA GAMING PRIVATE LIMITED, not Apple Inc.

Apple is not responsible for:

• WalkChamp
• Maintenance
• Support
• Challenges
• Prizes
• Payments
• Refunds
• Results
• Content
• Claims

Mira Gaming is responsible for addressing claims concerning WalkChamp.

Apple and its subsidiaries may be third-party beneficiaries of these Terms where applicable.

You must comply with applicable Apple Media Services Terms and Usage Rules.

Apple Health information must not be used for prohibited marketing or advertising purposes.

Apple payment rules apply to eligible digital content and virtual items.

Cash-entry functionality must receive all required legal and App Review approval before release.`,
    },
    {
      id: "google-play-terms",
      number: 32,
      title: "Google Play Terms",
      keywords: ["google play","android","billing"],
      body: `Google is not a party to these Terms.

Google does not sponsor, administer, endorse, or provide prizes for WalkChamp Challenges.

Users must comply with Google Play terms and policies.

Digital Coins and virtual items may be subject to Google Play Billing requirements.

Cash Prize Challenges may be unavailable in a Google Play-distributed build.

Mira Gaming may:

• Disable Cash Prize Challenges on Android
• Restrict cash functionality by region
• Use a different legally compliant distribution method
• Provide different functionality by platform

Availability depends on:

• Applicable law
• Licensing
• Google Play policy
• Payment-provider approval
• Legal review

WalkChamp must not claim that skill-based cash-entry competitions are automatically permitted on Google Play.`,
    },
    {
      id: "disclaimer-of-warranties",
      number: 33,
      title: "Disclaimer of Warranties",
      keywords: ["as is","warranty","disclaimer"],
      body: `To the maximum extent permitted by law, WalkChamp is provided:

"AS IS"

and:

"AS AVAILABLE"

without warranties of any kind.

Mira Gaming does not guarantee:

• Uninterrupted operation
• Error-free operation
• Device compatibility
• Health-platform accuracy
• Wearable synchronization
• Step accuracy
• Internet availability
• Third-party provider availability
• Winning
• Prize eligibility
• Immediate payouts
• Error correction

Some jurisdictions do not allow certain warranty exclusions.

Mandatory legal rights remain unaffected.`,
    },
    {
      id: "limitation-of-liability",
      number: 34,
      title: "Limitation of Liability",
      keywords: ["liability","damages","usd 100"],
      body: `To the maximum extent permitted by law, Mira Gaming and its directors, officers, employees, affiliates, licensors, sponsors, and providers are not liable for indirect, incidental, special, consequential, exemplary, or punitive damages arising from:

• Loss of profit
• Loss of data
• Business interruption
• Missed steps
• Device errors
• Provider errors
• Lost opportunities
• Delayed synchronization
• Unauthorized Account access
• Unsafe User conduct

Where liability cannot be excluded, Mira Gaming's total aggregate liability will be limited to the greater of:

A. The amount paid directly to Mira Gaming through WalkChamp during the 12 months before the event giving rise to the claim; or

B. USD 100 or the local-currency equivalent

unless applicable law requires a higher amount or prohibits this limitation.

Nothing excludes liability that cannot legally be excluded, including liability for fraud, willful misconduct, or mandatory consumer rights.`,
    },
    {
      id: "indemnity",
      number: 35,
      title: "Indemnity",
      keywords: ["indemnify","claims"],
      body: `To the extent permitted by law, you agree to indemnify Mira Gaming and its personnel against third-party claims, losses, liabilities, and reasonable costs arising from:

• Unlawful use
• Fraud
• Cheating
• Infringing User Content
• Violation of these Terms
• Harm caused to another person
• Violation of another person's rights

This obligation does not apply to losses caused by Mira Gaming's own negligence, willful misconduct, or unlawful conduct.`,
    },
    {
      id: "governing-law-dispute-resolution",
      number: 36,
      title: "Governing Law and Dispute Resolution",
      keywords: ["arbitration","hyderabad","india","governing law","dispute"],
      body: `These Terms are governed by the laws of India, subject to any mandatory consumer rights in your place of residence.

Before starting formal proceedings, contact:

admin@miragaming.com

and allow at least 30 days for good-faith resolution, unless immediate legal action is permitted or required.

Where legally enforceable, unresolved disputes may be referred to arbitration under the Arbitration and Conciliation Act, 1996.

Proposed arbitration terms:

• One arbitrator
• English language
• Seat and venue: Hyderabad, Telangana, India

Courts located in Hyderabad, Telangana, India will have jurisdiction over disputes not subject to arbitration.

Nothing in this section prevents a User from approaching a consumer commission, regulator, court, small-claims forum, or other body where that right cannot legally be waived.`,
    },
    {
      id: "general-provisions",
      number: 37,
      title: "General Provisions",
      keywords: ["severability","waiver","assignment","entire agreement"],
      body: `Severability:

If any provision is invalid or unenforceable, the remaining provisions remain effective.

No Waiver:

Failure to enforce a provision is not a waiver of future enforcement.

Assignment:

You may not assign these Terms without written permission.

Mira Gaming may assign these Terms in connection with a merger, restructuring, financing, sale, or transfer.

No Agency:

These Terms do not create an employment, partnership, agency, joint venture, or fiduciary relationship.

Entire Agreement:

These Terms, the Privacy Policy, Challenge Rules, promotion rules, and Sponsored Event rules form the entire agreement regarding WalkChamp.

Electronic Acceptance:

Electronic acceptance, clicks, checkboxes, and digital records may be used to show agreement where legally permitted.

Headings:

Section headings are for convenience and do not affect interpretation.

Language:

If these Terms are translated, the English version controls to the extent permitted by law.

Survival:

Payment, fraud, tax, intellectual property, dispute, liability, indemnity, and other provisions that should logically survive remain effective after termination.`,
    },
    {
      id: "changes-to-these-terms",
      number: 38,
      title: "Changes to These Terms",
      keywords: ["update","changes","last updated"],
      body: `Mira Gaming may update these Terms to reflect:

• Product changes
• Legal changes
• Security changes
• Provider changes
• Payment changes
• App-store rules
• Business changes

The Last Updated date will be revised.

Material changes may be communicated through:

• In-app notice
• Email
• Push notification
• Website notice
• Consent screen where required

Additional consent will be obtained where required by law.

Challenges created or joined before a material change may remain subject to the rules displayed when the User registered where required for fairness or contractual consistency.`,
    },
    {
      id: "contact-us",
      number: 39,
      title: "Contact Us",
      keywords: ["contact","email","address","mira gaming"],
      body: `MIRA GAMING PRIVATE LIMITED

Registered Office:

H. No. 436/P, Near Oxford
Sriram Nagar Colony, Suraram
Tirumalagiri, Hyderabad – 500055
Telangana, India

Support Email:

admin@miragaming.com

Legal and Privacy Email:

admin@miragaming.com`,
    },
  ],
};

export function searchTermsSections(query: string): TermsSection[] {
  const q = query.trim().toLowerCase();
  if (!q) return TERMS_DOCUMENT.sections;
  return TERMS_DOCUMENT.sections.filter((section) => {
    const haystack = [`${section.number}`, section.title, section.body, ...section.keywords]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}
