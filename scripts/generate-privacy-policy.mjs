/**
 * One-shot generator for constants/privacyPolicy.ts
 * Run: node scripts/generate-privacy-policy.mjs
 */
import fs from "node:fs";
import path from "node:path";

const sections = [
  {
    n: 1,
    title: "INTRODUCTION",
    body: `This Privacy Policy explains how MIRA GAMING PRIVATE LIMITED ("Mira Gaming," "Company," "we," "us," or "our") collects, uses, stores, shares, and protects information when you access or use Walk Champ, including the Walk Champ mobile application, websites, services, features, challenges, races, groups, communications, payments, and related services collectively referred to as the "Service."

Company Details:

MIRA GAMING PRIVATE LIMITED
H. No. 436/P, Near Oxford,
Sriram Nagar Colony, Suraram,
Tirumalagiri, Hyderabad – 500055,
Telangana, India

Support and Privacy Contact:
admin@miragaming.com

Walk Champ is a walking, fitness, social competition, and challenge platform. Depending on your location and eligibility, the Service may include:

• Daily step tracking
• Free walking challenges
• Coins Battles
• Cash Prize Challenges
• Sponsored Events
• Public and private races
• Scheduled races and Waiting Rooms
• Live Race Tracks and Live Boards
• Groups and group leaderboards
• Achievements and titles
• Chat, cheers, voice, and social features
• Referrals and promotions
• Wallet, payment, refund, and payout features

By using Walk Champ, you acknowledge that you have read and understood this Privacy Policy.

If you do not agree with this Privacy Policy, do not access or use Walk Champ.`,
  },
  {
    n: 2,
    title: "SCOPE OF THIS PRIVACY POLICY",
    body: `This Privacy Policy applies to information processed through:

• The Walk Champ mobile application
• Walk Champ websites and web pages
• Walk Champ user accounts
• Challenge and race participation
• Groups, chats, messages, and voice features
• Wallet, payment, refund, and payout functions
• Customer support communications
• Promotions, referrals, and Sponsored Events
• Administrative, fraud-prevention, security, and compliance systems

This Privacy Policy does not govern third-party websites, applications, payment providers, health platforms, social networks, app stores, or services that have their own privacy policies.`,
  },
  {
    n: 3,
    title: "DEFINITIONS",
    body: `For this Privacy Policy:

"Account" means a Walk Champ user account.

"Application" or "App" means the Walk Champ mobile application.

"Cash Prize Challenge" means an eligible skill-based walking challenge involving a monetary entry contribution or cash reward.

"Challenge" means any Free Challenge, Coins Battle, Cash Prize Challenge, Sponsored Event, public room, private room, scheduled race, group challenge, or other supported competition.

"Coins" means virtual in-app items or balances used in supported Walk Champ features. Coins are not automatically equivalent to cash and may not be withdrawable.

"Health Data" means fitness and physical-activity information accessed through Apple Health, Health Connect, a supported device, or a supported wearable integration, including step count and related activity records.

"Personal Data" means information that identifies, relates to, describes, or can reasonably be linked with an individual.

"Processing" means collecting, recording, organizing, using, storing, transmitting, sharing, deleting, or otherwise handling information.

"Service Provider" means a third party that processes information to help us operate Walk Champ.

"Sponsored Event" means a Challenge funded, organized, promoted, or supported by Mira Gaming or an approved sponsor or partner.

"Usage Data" means technical and activity information generated when you use the Service.

"User," "you," or "your" means the person accessing or using Walk Champ.`,
  },
  {
    n: 4,
    title: "INFORMATION WE COLLECT",
    body: `We collect information in the following ways:

• Information you provide directly
• Information generated through your use of Walk Champ
• Information received from Apple Health or Health Connect with your permission
• Information received from payment, payout, authentication, communications, and infrastructure providers
• Information received from other users when they interact with you
• Information collected for fraud prevention, security, regional eligibility, and legal compliance`,
  },
  {
    n: 5,
    title: "ACCOUNT AND PROFILE INFORMATION",
    body: `When you register for or use Walk Champ, we may collect:

• Name
• Display name
• Username
• Email address
• Phone number
• Date of birth or age confirmation
• Country
• State, province, or region
• Profile photograph or avatar
• Preferred language
• Timezone
• Referral code
• Account creation date
• Authentication identifiers
• Login and session information
• Account status
• Friend and social-connection information
• Equipped achievements or titles
• Public-profile settings
• Communication and notification preferences

We may also receive limited account information from supported sign-in providers when you choose social or third-party authentication.`,
  },
  {
    n: 6,
    title: "HEALTH AND FITNESS INFORMATION",
    body: `Walk Champ uses health and fitness data to provide step tracking, challenge participation, race progress, rankings, winner determination, fraud prevention, and related features.

Depending on your device, Walk Champ may access information from:

• Apple Health on iOS
• Health Connect on Android
• Supported wearable applications that write data to Apple Health or Health Connect

Health and fitness information may include:

• Step count
• Walking or running distance, when supported and authorized
• Activity dates and timestamps
• Time-based step records
• Data-source information
• Device or sensor source
• Synchronization timestamps
• Records required to distinguish race steps from total daily steps
• Information needed to detect duplicate, manually entered, altered, delayed, or suspicious records
• Challenge progress derived from eligible step records
• Goal-completion timestamps
• Activity summaries displayed in the App

Walk Champ requests only the health permissions that are reasonably necessary for active features.

You control health permissions through your device settings.

If you deny or revoke health permission:

• Some daily-step features may not work
• You may be unable to join or continue eligible Challenges
• Race progress may not update
• Walk Champ may be unable to verify your results
• Previously processed records may remain where necessary for completed Challenges, disputes, fraud prevention, legal compliance, and financial recordkeeping`,
  },
  {
    n: 7,
    title: "APPLE HEALTH INFORMATION",
    body: `On compatible iOS devices, Walk Champ may read step and related activity information that you authorize through Apple Health.

Walk Champ:

• Requests permission before accessing Apple Health information
• Accesses only authorized data types
• Uses Apple Health information to provide fitness and challenge features
• Does not use Apple Health information for targeted advertising
• Does not use Apple Health information for advertising measurement
• Does not sell Apple Health information
• Does not provide Apple Health information to data brokers
• Does not use Apple Health information to determine creditworthiness
• Does not use Apple Health information for unrelated marketing profiles
• Does not use Apple Health information for medical diagnosis or treatment
• Does not knowingly use individual-level Apple Health information to train third-party artificial intelligence models

Walk Champ may use Apple Health information to:

• Display your step progress
• Track eligible Challenge activity
• Calculate race progress
• Determine rankings and goal completion
• Verify results
• Detect duplicate or suspicious activity
• Resolve disputes
• Improve fitness and challenge functionality

Walk Champ is not a medical application and does not provide medical advice, diagnosis, or treatment.`,
  },
  {
    n: 8,
    title: "HEALTH CONNECT INFORMATION",
    body: `On compatible Android devices, Walk Champ may read step and related activity information that you authorize through Health Connect.

Walk Champ:

• Requests user authorization
• Requests only health permissions needed for supported features
• Uses Health Connect information for visible fitness, gaming, reward, and challenge functions
• Does not sell Health Connect data
• Does not share Health Connect information with advertisers or data brokers
• Does not use Health Connect information for targeted advertising
• Does not use Health Connect information to determine insurance or employment eligibility
• Does not use Health Connect information to determine creditworthiness
• Does not use Health Connect information for unauthorized profiling
• Does not knowingly use individual-level Health Connect information to train third-party artificial intelligence models

Health Connect information may be used for:

• Step tracking
• Challenge participation
• Race progress
• Goal verification
• Rankings
• Rewards
• Fraud detection
• Technical support
• Dispute resolution
• Improving the related user-facing fitness features

You can manage Walk Champ's Health Connect permissions through the Health Connect settings on your device.`,
  },
  {
    n: 9,
    title: "LIMITATIONS OF HEALTH AND FITNESS INFORMATION",
    body: `Walk Champ relies on information provided by Apple Health, Health Connect, devices, sensors, and supported wearable applications.

We cannot guarantee that:

• Every device records steps in the same way
• Every wearable synchronizes immediately
• Third-party wearable applications will always write complete records
• Health platforms will display the same number as a wearable's own application
• Activity will be recoverable if it was never recorded or synchronized
• Battery, permission, device, network, or operating-system problems will not cause delays

Health platforms may combine, filter, prioritize, or remove duplicate activity records.

Users are responsible for:

• Keeping tracking devices charged
• Carrying or wearing a supported device
• Maintaining required permissions
• Confirming synchronization
• Reviewing Challenge progress before a race ends
• Reporting discrepancies promptly`,
  },
  {
    n: 10,
    title: "CHALLENGE AND RACE INFORMATION",
    body: `When you create, register for, join, host, watch, or participate in a Challenge, we may process:

• Challenge ID
• Room ID
• Challenge type
• Host information
• Participant information
• Registration status
• Entry type
• Entry amount
• Coin entry
• Prize pool
• Reward type
• Start date and time
• End date and time
• Duration
• Step goal
• Participant capacity
• Country or regional availability
• Public or private status
• Invite code
• Withdrawal status
• Cancellation status
• Forfeit status
• Disqualification status
• Current steps
• Goal-completion time
• Rank
• Final result
• Winner status
• Reward or payout status
• Waiting Room presence
• Live race status
• Spectator status
• Race Track and Live Board information

Some Challenge information is visible to other users.`,
  },
  {
    n: 11,
    title: "INFORMATION VISIBLE TO OTHER USERS",
    body: `Walk Champ contains social, competitive, and public-facing features.

Depending on the feature and your settings, other users may see:

• Username
• Display name
• Profile image or avatar
• Country flag
• Equipped title
• Host badge
• Online or offline indicator
• Challenge participation
• Step progress
• Current rank
• Final rank
• Race results
• Challenge history
• Public achievements
• Public statistics
• Group membership where applicable
• Messages, cheers, reactions, or other content you post
• Whether you are the host, participant, winner, or spectator

Do not post information that you consider confidential.

Other users may capture, copy, save, or re-share information that is visible to them. We cannot guarantee how another user will handle information you voluntarily make public.`,
  },
  {
    n: 12,
    title: "GROUPS, FRIENDS, AND SOCIAL INFORMATION",
    body: `If you use Groups, friends, public profiles, chat, or other social features, we may process:

• Friend requests
• Accepted friendships
• Group memberships
• Group names
• Group categories
• Group themes
• Group goals
• Group progress
• Group ranks
• Administrator status
• Invitations
• Direct messages
• Reactions
• Replies
• Public-profile views
• Reports and moderation activity

We use this information to operate social features, display leaderboards, provide communications, and enforce community standards.`,
  },
  {
    n: 13,
    title: "CHAT, MESSAGES, CHEERS, AND COMMUNITY CONTENT",
    body: `When you use chat or communication features, we may collect:

• Message content
• Message timestamps
• Sender and recipient identifiers
• Room or race identifiers
• Reactions
• Replies
• Cheers
• Report information
• Moderation decisions
• Technical delivery status

Messages may be stored for:

• Delivering the communication
• Displaying conversation history
• Safety and moderation
• Investigating abuse
• Enforcing Terms and community rules
• Resolving disputes
• Complying with legal obligations

Do not use Walk Champ to share passwords, full card details, government identification numbers, private health records, or other sensitive information.`,
  },
  {
    n: 14,
    title: "VOICE AND AUDIO FEATURES",
    body: `Where voice or audio features are available, Walk Champ may request microphone permission.

We may process:

• Microphone access status
• Voice-room membership
• Audio connection status
• Mute settings
• Live audio streams
• Technical quality information
• Network and latency information

Live audio may be transmitted through a communications service provider.

Unless explicitly disclosed at the time, Walk Champ does not routinely record or permanently store live voice conversations.

We may retain limited metadata required for connection, moderation, security, abuse investigation, and technical support.`,
  },
  {
    n: 15,
    title: "LOCATION AND REGIONAL INFORMATION",
    body: `Walk Champ may collect or infer location-related information, including:

• Country
• State or province
• City or approximate area
• IP-based location
• Device timezone
• IANA timezone identifier
• Foreground location when permitted
• Location-verification result
• Region-eligibility status

We may use location and timezone information to:

• Display accurate scheduled times
• Synchronize your timezone
• Apply country or state restrictions
• Determine eligibility for Cash Prize Challenges
• Select currency and payment provider
• Prevent location fraud
• Comply with applicable laws
• Investigate suspicious activity
• Provide local availability information

Walk Champ does not require continuous background location unless a clearly disclosed feature specifically needs it and you grant permission.

Where feasible, we use the least precise location sufficient for the feature.`,
  },
  {
    n: 16,
    title: "DEVICE, TECHNICAL, AND USAGE INFORMATION",
    body: `We may automatically collect:

• IP address
• Device model
• Device manufacturer
• Operating system
• Operating-system version
• App version
• Device identifiers
• Installation identifier
• Authentication token identifiers
• Timezone
• Language
• Network type
• Mobile carrier
• Crash reports
• Performance information
• Screen and feature usage
• API request logs
• Login activity
• Session duration
• Referral source
• Notification delivery status
• Security events
• Error codes
• Diagnostic information

We use this information for:

• Authentication
• Service operation
• Troubleshooting
• Performance improvement
• Security
• Fraud prevention
• Analytics
• Feature improvement
• Compliance
• Customer support`,
  },
  {
    n: 17,
    title: "PAYMENT INFORMATION",
    body: `Walk Champ may use Stripe, Razorpay, app stores, and other approved payment providers depending on your country, currency, device, and transaction type.

When you make a payment, the payment provider may collect:

• Name
• Billing address
• Email
• Phone number
• Card details
• Bank or payment-account details
• UPI information
• Payment token
• Transaction identifier
• Payment status
• Currency
• Country
• Tax information
• Fraud and risk signals

Mira Gaming does not intend to store complete payment-card numbers or card security codes on its own servers.

We may receive and store limited payment information, such as:

• Payment-provider customer ID
• Payment method type
• Card brand
• Last four digits, where provided
• Transaction reference
• Payment status
• Refund status
• Currency
• Amount
• Provider fee
• Challenge or order reference
• Fraud and risk results

Payment providers process information under their own privacy policies and legal obligations.`,
  },
  {
    n: 18,
    title: "STRIPE",
    body: `For transactions processed through Stripe, Stripe may collect and process payment, identity, device, fraud-prevention, billing, and transaction information.

We may share with Stripe information reasonably required to:

• Process payments
• Issue refunds
• Verify transactions
• Prevent fraud
• Manage disputes and chargebacks
• Meet regulatory requirements
• Support payouts where applicable

Stripe's services may not be available for every user, country, or transaction.`,
  },
  {
    n: 19,
    title: "RAZORPAY",
    body: `For transactions processed through Razorpay, Razorpay may collect and process payment, UPI, card, banking, billing, identity, device, fraud-prevention, and transaction information.

We may share with Razorpay information reasonably required to:

• Process payments
• Issue refunds
• Verify transactions
• Prevent fraud
• Handle disputes
• Comply with Indian payment and financial requirements
• Support payouts where applicable

Razorpay's services may not be available for every user, country, or transaction.`,
  },
  {
    n: 20,
    title: "WALLET, TRANSACTION, REFUND, AND PAYOUT INFORMATION",
    body: `We may collect and maintain information relating to:

• Cash balance
• Coin balance
• Promotional credits
• Entry contributions
• Processing fees
• Platform or service fees
• Taxes
• Prize pools
• Refunds
• Reversals
• Winnings
• Payout requests
• Payout method
• Payout status
• Payment-provider references
• Chargebacks
• Disputes
• Financial verification
• Transaction history
• Minimum payout eligibility
• Regulatory holds

Cash, coins, promotional credits, and restricted balances may have different rules.

We may require identity, age, tax, address, location, or payout verification before releasing cash winnings.`,
  },
  {
    n: 21,
    title: "IDENTITY, AGE, KYC, TAX, AND COMPLIANCE INFORMATION",
    body: `For paid features, payouts, high-value transactions, regulatory compliance, fraud prevention, or account security, we or a Service Provider may request:

• Full legal name
• Date of birth
• Address
• Nationality
• Country of residence
• Government-issued identification
• Tax identifier
• Photograph or selfie
• Identity-verification result
• Bank or payout information
• Source-of-funds information where legally required
• Sanctions or restricted-party screening
• Age-verification result

Where possible, identity documents are collected directly by the verification provider rather than stored by Mira Gaming.

We may retain verification status, provider reference, result, and limited compliance records.`,
  },
  {
    n: 22,
    title: "REFERRAL AND INVITE INFORMATION",
    body: `When you use referrals or invitations, we may process:

• Referral code
• Referral link
• Referring account
• Referred account
• Referral status
• Registration date
• Qualifying action
• Reward status
• Promotional credit
• Fraud or eligibility result
• Invite sharing action
• Limited recipient information if you provide it directly

We use referral information to:

• Administer the referral program
• Track eligibility
• Award supported benefits
• Prevent self-referrals and abuse
• Investigate coordinated or duplicate accounts

If Walk Champ accesses contacts in the future, it will request permission and explain the purpose before access.`,
  },
  {
    n: 23,
    title: "PUSH NOTIFICATIONS",
    body: `If you enable notifications, we may collect:

• Push notification token
• Device identifier
• Notification preference
• Delivery and interaction status

Notifications may include:

• Challenge invitations
• Registration confirmations
• Race-start alerts
• Waiting Room updates
• Results
• Rewards
• Wallet activity
• Friend requests
• Group activity
• Security notices
• Support messages
• Feature announcements
• Promotional messages where permitted

You can disable notifications through Walk Champ or your device settings.

Disabling notifications may prevent you from receiving time-sensitive race alerts.`,
  },
  {
    n: 24,
    title: "CAMERA, PHOTOS, AND MEDIA",
    body: `Walk Champ may request access to the camera or photo library when you choose to:

• Upload a profile image
• Change an avatar
• Share a screenshot or report
• Scan a supported code
• Upload verification information
• Send supported media

We access only the media you select or create for the requested feature, subject to your device permissions.`,
  },
  {
    n: 25,
    title: "INFORMATION FROM SERVICE PROVIDERS",
    body: `Walk Champ may use service providers for:

• Authentication
• Cloud hosting
• Databases
• File storage
• Payments
• Payouts
• Push notifications
• Realtime updates
• Voice communication
• Email
• Analytics
• Fraud prevention
• Identity verification
• Customer support
• Crash reporting
• Security monitoring

Based on the services enabled in Walk Champ, providers may include services such as:

• Stripe
• Razorpay
• Apple
• Google
• Descope
• Neon or other database providers
• Cloud or object-storage providers
• Pusher or other realtime providers
• OneSignal or other notification providers
• LiveKit or other audio/video providers
• App-store payment and distribution providers

The final published policy should list only providers actually used in the production version.`,
  },
  {
    n: 26,
    title: "HOW WE USE INFORMATION",
    body: `We may use information to:

• Create and manage Accounts
• Authenticate users
• Provide step tracking
• Operate Challenges
• Create and manage rooms
• Process registrations
• Calculate progress
• Operate Waiting Rooms
• Display participants
• Maintain Race Tracks and Live Boards
• Calculate rankings and results
• Determine winner eligibility
• Distribute rewards
• Operate Coins Battles
• Operate Cash Prize Challenges
• Operate Sponsored Events
• Manage Groups
• Provide chats, cheers, voice, and social functions
• Process payments
• Process refunds
• Process payouts
• Manage wallet balances
• Administer referrals and promotions
• Send notifications
• Personalize supported app functionality
• Synchronize timezone
• Apply regional availability
• Verify age, identity, or location
• Prevent cheating and fraud
• Enforce our Terms
• Moderate content
• Investigate disputes
• Provide customer support
• Diagnose errors
• Improve performance
• Develop new features
• Conduct internal analytics
• Meet legal and regulatory obligations
• Protect users, Mira Gaming, and the public`,
  },
  {
    n: 27,
    title: "HEALTH DATA USE RESTRICTIONS",
    body: `We do not:

• Sell Health Data
• Rent Health Data
• Share Health Data with data brokers
• Use Health Data for targeted advertising
• Use Health Data for cross-context behavioral advertising
• Use Health Data to determine creditworthiness
• Use Health Data to determine insurance eligibility
• Use Health Data to determine employment eligibility
• Use Health Data for unrelated data mining
• Use Health Data for medical diagnosis or treatment
• Permit advertisers to build profiles from Health Data

We may process Health Data for fraud prevention, security, result verification, technical support, legal compliance, and user-requested fitness features.`,
  },
  {
    n: 28,
    title: "ADVERTISING AND MARKETING",
    body: `Walk Champ may send service-related messages and, where legally permitted, marketing communications.

We do not use Apple Health or Health Connect data to target advertising.

If Walk Champ introduces advertising:

• Health Data will not be used to personalize advertisements
• Sensitive payment or identity information will not be used for ad targeting
• Required consent and opt-out controls will be provided
• This Privacy Policy will be updated

You can opt out of marketing communications while continuing to receive necessary service and security notices.`,
  },
  {
    n: 29,
    title: "FRAUD PREVENTION AND FAIR PLAY",
    body: `We may process information to detect:

• Manipulated step data
• Manually entered steps
• Duplicate step records
• Device or sensor anomalies
• Multiple-account abuse
• Referral fraud
• Payment fraud
• Chargeback abuse
• Location spoofing
• Unauthorized automation
• Modified devices or emulators
• Account sharing
• Coordinated unfair outcomes
• Suspicious registrations
• Suspicious withdrawals
• Identity inconsistencies
• Abuse of promotions or refunds

Fraud-prevention information may include:

• User identifiers
• Device information
• IP address
• Health-data source metadata
• Step patterns
• Payment references
• Hashed or tokenized payment indicators
• Location and timezone inconsistencies
• Login history
• Account relationships
• Referral history
• Transaction behavior
• Challenge behavior
• Reports from users

We may take action including:

• Additional verification
• Temporary holds
• Step exclusion
• Challenge removal
• Disqualification
• Prize forfeiture
• Refund denial
• Account restriction
• Account suspension
• Account termination
• Reporting suspected unlawful conduct`,
  },
  {
    n: 30,
    title: "AUTOMATED PROCESSING",
    body: `Walk Champ may use automated systems to:

• Calculate rankings
• Determine progress
• Identify completion times
• Detect duplicate activity
• Flag suspicious transactions
• Assess regional eligibility
• Identify potential fraud
• Prioritize support or security review

Where required by applicable law, you may request human review of a decision that produces a significant legal or similarly important effect.

Automated flags do not necessarily mean wrongdoing has occurred.`,
  },
  {
    n: 31,
    title: "LEGAL BASES FOR PROCESSING",
    body: `Depending on your location and applicable law, we process information based on one or more of the following:

• Performance of a contract with you
• Your consent
• Compliance with a legal obligation
• Protection of vital interests
• Legitimate interests
• Establishment, exercise, or defense of legal claims
• Other legal grounds recognized by applicable law

Examples include:

Contract:
Operating your Account, Challenge participation, payments, rewards, and support.

Consent:
Accessing Apple Health, Health Connect, location, microphone, notifications, camera, and marketing communications where consent is required.

Legal obligations:
Financial recordkeeping, tax, KYC, anti-fraud, payment, regulatory, and law-enforcement requirements.

Legitimate interests:
Security, fraud prevention, product improvement, service analytics, dispute resolution, and protection of our users and business.`,
  },
  {
    n: 32,
    title: "WHEN WE SHARE INFORMATION",
    body: `We may share information with:

• Payment processors
• Payout providers
• Identity-verification providers
• Authentication providers
• Cloud-hosting providers
• Database and storage providers
• Notification providers
• Realtime communication providers
• Voice and audio providers
• Customer-support providers
• Security and fraud-prevention providers
• Analytics and crash-reporting providers
• Professional advisers
• Auditors
• Insurers
• Banking and financial partners
• Sponsors or event partners where disclosed
• Government or regulatory authorities
• Courts and law-enforcement agencies
• A successor in a merger, acquisition, financing, restructuring, or sale

Service Providers are permitted to process information only for contracted or legally permitted purposes.`,
  },
  {
    n: 33,
    title: "SPONSORED EVENTS AND PARTNERS",
    body: `For a Sponsored Event, Walk Champ may share limited information with the sponsor or organizer where necessary and disclosed.

This may include:

• Registration status
• Public profile information
• Challenge progress
• Ranking
• Winner status
• Reward-delivery information
• Eligibility confirmation

We will not provide individual Health Data to a sponsor for unrelated marketing without valid permission.

If physical prizes are offered, the sponsor or fulfillment provider may need your name, address, phone number, or email to deliver the reward.`,
  },
  {
    n: 34,
    title: "LEGAL DISCLOSURE",
    body: `We may disclose information when we reasonably believe it is necessary to:

• Comply with law
• Respond to a lawful request
• Comply with a court order
• Meet regulatory obligations
• Investigate suspected fraud or crime
• Enforce our Terms
• Protect rights or property
• Protect users or the public
• Prevent immediate harm
• Establish or defend legal claims

We review requests for legal validity where reasonably possible.`,
  },
  {
    n: 35,
    title: "INTERNATIONAL DATA TRANSFERS",
    body: `Walk Champ is operated by MIRA GAMING PRIVATE LIMITED in India and is intended for global use.

Your information may be processed in India, the United States, the European Economic Area, Singapore, or other countries where Mira Gaming or its Service Providers operate.

These countries may have data-protection laws different from those in your location.

Where required, we use appropriate protections for international transfers, which may include:

• Contractual safeguards
• Standard contractual clauses
• Data-processing agreements
• Consent
• Adequacy mechanisms
• Security controls
• Other lawful transfer mechanisms`,
  },
  {
    n: 36,
    title: "DATA STORAGE",
    body: `Information may be stored:

• On your device
• In secure cloud infrastructure
• In managed databases
• In encrypted object storage
• In payment, authentication, communications, and notification systems
• In backups
• In security, fraud, and audit logs

The production version of Walk Champ should maintain an accurate internal list of storage locations, data categories, processors, and retention periods.`,
  },
  {
    n: 37,
    title: "DATA RETENTION",
    body: `We retain information only for as long as reasonably necessary for the purposes described in this Privacy Policy, including legal, security, financial, fraud-prevention, dispute-resolution, and operational requirements.

Typical retention may include:

Account and profile information:
For the life of the Account and for a limited period after closure where needed for legal, security, support, and dispute purposes.

Challenge and race records:
For as long as needed to maintain history, results, rankings, disputes, fraud prevention, legal records, and financial reconciliation.

Health and fitness information:
For the life of the Account and for a limited period after closure where needed for challenge verification, disputes, fraud prevention, and legal obligations. Users may request deletion subject to lawful exceptions.

Payment, refund, payout, and transaction records:
For the period required by tax, accounting, banking, payment, anti-fraud, and regulatory laws, which may be seven years or longer where required.

Fraud-prevention and security records:
For as long as reasonably necessary to identify repeat abuse, protect users, enforce Terms, resolve disputes, and comply with law.

Chats and community content:
For as long as necessary to provide the feature, investigate reports, resolve disputes, and enforce community rules.

Support records:
For as long as needed to resolve the request, maintain service history, enforce rights, and meet legal requirements.

Backups:
Deleted information may remain in protected backups for a limited period until overwritten or securely removed.`,
  },
  {
    n: 38,
    title: "SECURITY",
    body: `We use reasonable administrative, organizational, physical, and technical measures designed to protect information.

Measures may include:

• Encryption in transit
• Encryption at rest where appropriate
• Access controls
• Authentication
• Role-based permissions
• Secure credential storage
• Tokenization
• Network protections
• Logging and monitoring
• Backup protection
• Secure-development practices
• Vulnerability management
• Incident-response procedures
• Provider security reviews

No internet transmission or storage system is completely secure.

You are responsible for keeping your Account credentials confidential and notifying us of suspected unauthorized access.`,
  },
  {
    n: 39,
    title: "DATA BREACH RESPONSE",
    body: `If a security incident affects Personal Data, we will:

• Investigate the incident
• Take reasonable containment and remediation steps
• Assess legal notification obligations
• Notify affected users where required
• Notify regulators where required
• Provide available information about protective steps

Notifications will be made within the period required by applicable law.`,
  },
  {
    n: 40,
    title: "YOUR PRIVACY RIGHTS",
    body: `Depending on your location, you may have rights to:

• Access Personal Data
• Obtain a copy of Personal Data
• Correct inaccurate information
• Delete information
• Restrict Processing
• Object to Processing
• Withdraw consent
• Obtain portable data
• Appeal a privacy decision
• Request information about sharing
• Opt out of certain marketing
• Opt out of sale or sharing where applicable
• Limit certain uses of sensitive information
• Lodge a complaint with a regulator

Rights are subject to legal exceptions and verification.

To submit a request, email:

admin@miragaming.com

Suggested subject:

Walk Champ Privacy Request

Include:

• Your Walk Champ username
• Account email
• Country or region
• The right you wish to exercise
• Information reasonably required to verify the request

Do not email passwords, full payment-card details, or security codes.`,
  },
  {
    n: 41,
    title: "WITHDRAWING CONSENT",
    body: `You may withdraw consent for optional Processing at any time.

Examples:

• Disable health permission
• Disable location permission
• Disable microphone permission
• Disable camera permission
• Disable push notifications
• Opt out of marketing
• Delete your Account

Withdrawal does not affect Processing that occurred lawfully before withdrawal.

Some Service features may stop working after permission is withdrawn.`,
  },
  {
    n: 42,
    title: "ACCOUNT DELETION",
    body: `You can request deletion using the Delete Account feature in Walk Champ or by contacting:

admin@miragaming.com

Before deleting your Account:

• Withdraw eligible cash balances
• Review pending payouts
• Resolve active payment disputes
• Complete or leave active Challenges where required
• Save any information you need

When deletion is requested, we will delete or de-identify information that is no longer required.

We may retain information where necessary for:

• Financial records
• Taxes
• Anti-fraud obligations
• Legal compliance
• Security
• Disputes
• Chargebacks
• Payouts
• Unclaimed funds
• Enforcement of Terms
• Legal claims

Account deletion does not automatically erase information that another user has independently copied or shared.`,
  },
  {
    n: 43,
    title: "INDIA PRIVACY RIGHTS",
    body: `Users in India may have rights under applicable Indian data-protection law, including rights relating to:

• Access to information about Processing
• Correction and completion
• Erasure
• Grievance redressal
• Nomination where applicable
• Withdrawal of consent

Requests may be sent to:

admin@miragaming.com

Subject:

India Privacy Request`,
  },
  {
    n: 44,
    title: "EUROPEAN ECONOMIC AREA, UNITED KINGDOM, AND SWITZERLAND",
    body: `If you are located in the European Economic Area, United Kingdom, or Switzerland, you may have rights including:

• Access
• Rectification
• Erasure
• Restriction
• Portability
• Objection
• Withdrawal of consent
• Complaint to a supervisory authority
• Human review of certain automated decisions

Where we rely on legitimate interests, you may request information about the relevant interest.

Where we rely on consent, you may withdraw it at any time.`,
  },
  {
    n: 45,
    title: "CALIFORNIA PRIVACY NOTICE",
    body: `California residents may have rights under the California Consumer Privacy Act, as amended, subject to its applicability and exceptions.

These rights may include:

• Right to know
• Right to access
• Right to delete
• Right to correct
• Right to know categories of sources
• Right to know business purposes
• Right to know categories of recipients
• Right to opt out of sale or sharing
• Right to limit certain uses of sensitive information
• Right to non-discrimination

Walk Champ does not sell Health Data.

Walk Champ does not use Health Data for cross-context behavioral advertising.

Walk Champ does not sell Personal Data for money.

If our practices change, we will update this Privacy Policy and provide legally required controls before beginning the changed practice.

California requests may be sent to:

admin@miragaming.com

Subject:

California Privacy Request

We may verify your identity before completing a request.`,
  },
  {
    n: 46,
    title: "CATEGORIES OF PERSONAL INFORMATION",
    body: `Depending on your use of Walk Champ, categories processed may include:

• Identifiers
• Contact information
• Account credentials
• Customer records
• Commercial information
• Financial information
• Internet or network activity
• Device information
• Approximate or precise geolocation where authorized
• Health and fitness information
• Audio information
• Profile photographs
• Communications
• Inferences for security, eligibility, or fraud prevention
• Sensitive Personal Data
• Challenge and transaction history

We collect these categories from:

• You
• Your device
• Apple Health
• Health Connect
• Payment providers
• Authentication providers
• Other users
• Sponsors and partners
• Service Providers
• Security and fraud-prevention systems`,
  },
  {
    n: 47,
    title: "OTHER UNITED STATES PRIVACY RIGHTS",
    body: `Residents of certain US states may have rights to access, correct, delete, obtain portable data, opt out of certain Processing, or appeal a denied request.

Submit requests to:

admin@miragaming.com

Subject:

US State Privacy Request`,
  },
  {
    n: 48,
    title: "CHILDREN AND AGE RESTRICTIONS",
    body: `Cash Prize Challenges and other paid or payout-enabled features are intended only for users who meet the minimum legal age, which is generally 18 years or older unless a higher age applies.

Walk Champ is not intended to knowingly collect Personal Data from children below the minimum age permitted for the relevant Service without legally valid parental or guardian authorization.

If general non-cash features are made available to minors, Mira Gaming may apply:

• Age-appropriate restrictions
• Parental-consent requirements
• Disabled cash features
• Limited public-profile visibility
• Additional safety controls

If you believe a child has provided information without proper authorization, contact:

admin@miragaming.com

We will review the report and take appropriate action.`,
  },
  {
    n: 49,
    title: "RESPONSIBLE PARTICIPATION",
    body: `Walk Champ encourages responsible participation.

Users should:

• Set reasonable spending limits
• Avoid entering Challenges with money needed for essential expenses
• Take breaks when needed
• Review entry amounts and fees
• Understand that winning is not guaranteed
• Seek support if participation becomes harmful

We may provide spending, entry, account, or regional restrictions where appropriate.`,
  },
  {
    n: 50,
    title: "THIRD-PARTY LINKS",
    body: `Walk Champ may contain links to:

• Payment providers
• App stores
• Sponsors
• Social networks
• Help pages
• Legal documents
• External websites

Third-party services are governed by their own terms and privacy policies.

Mira Gaming is not responsible for the privacy practices of third parties.`,
  },
  {
    n: 51,
    title: "BUSINESS TRANSFERS",
    body: `If Mira Gaming is involved in a merger, acquisition, financing, restructuring, sale of assets, insolvency, or similar transaction, information may be transferred as part of that transaction.

Where required, we will provide notice before information becomes subject to materially different privacy terms.`,
  },
  {
    n: 52,
    title: "CHANGES TO THIS PRIVACY POLICY",
    body: `We may update this Privacy Policy to reflect:

• New features
• New providers
• New countries
• Legal changes
• Security changes
• Payment changes
• Health-platform requirements
• Business changes

We will update the "Last Updated" date.

For material changes, we may provide notice through:

• The App
• Email
• Push notification
• Website notice
• Consent request where required

Continued use after an effective update means the updated policy applies, except where law requires additional consent.`,
  },
  {
    n: 53,
    title: "LANGUAGE",
    body: `This Privacy Policy may be translated.

If translations conflict, the legally designated controlling version will apply, subject to applicable consumer law.`,
  },
  {
    n: 54,
    title: "GRIEVANCE AND PRIVACY CONTACT",
    body: `For privacy questions, data requests, complaints, or grievances, contact:

MIRA GAMING PRIVATE LIMITED

Address:
H. No. 436/P, Near Oxford,
Sriram Nagar Colony, Suraram,
Tirumalagiri, Hyderabad – 500055,
Telangana, India

Email:
admin@miragaming.com

Suggested subject lines:

• Walk Champ Privacy Request
• Walk Champ Account Deletion
• Walk Champ Data Correction
• Walk Champ Security Report
• Walk Champ Payment Privacy Question
• Walk Champ Health Data Request

Please include sufficient information for us to identify your Account and understand your request.`,
  },
  {
    n: 55,
    title: "CONTACT US",
    body: `For general support:

admin@miragaming.com

For privacy matters:

admin@miragaming.com

For account deletion:

admin@miragaming.com

For security concerns:

admin@miragaming.com

Company:

MIRA GAMING PRIVATE LIMITED
H. No. 436/P, Near Oxford,
Sriram Nagar Colony, Suraram,
Tirumalagiri, Hyderabad – 500055,
Telangana, India`,
  },
];

function slug(title, n) {
  return `${n}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

function escape(s) {
  return s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

const out = [];
out.push(`export type PrivacyPolicySection = {`);
out.push(`  id: string;`);
out.push(`  number: number;`);
out.push(`  title: string;`);
out.push(`  /** Full section body. Blank lines separate paragraphs; lines starting with • are bullets. */`);
out.push(`  body: string;`);
out.push(`};`);
out.push(``);
out.push(`export const PRIVACY_POLICY_TITLE = "WALK CHAMP PRIVACY POLICY";`);
out.push(`export const PRIVACY_POLICY_LAST_UPDATED = "July 21, 2026";`);
out.push(`export const PRIVACY_POLICY_SUPPORT_EMAIL = "admin@miragaming.com";`);
out.push(`export const PRIVACY_POLICY_PUBLIC_URL = "https://walkchamp.app/legal";`);
out.push(``);
out.push(`export const PRIVACY_POLICY_SECTIONS: PrivacyPolicySection[] = [`);

for (const s of sections) {
  out.push(`  {`);
  out.push(`    id: ${JSON.stringify(slug(s.title, s.n))},`);
  out.push(`    number: ${s.n},`);
  out.push(`    title: ${JSON.stringify(s.title)},`);
  out.push(`    body: \`${escape(s.body)}\`,`);
  out.push(`  },`);
}

out.push(`];`);
out.push(``);
out.push(`export function searchPrivacyPolicySections(query: string): PrivacyPolicySection[] {`);
out.push(`  const q = query.trim().toLowerCase();`);
out.push(`  if (!q) return PRIVACY_POLICY_SECTIONS;`);
out.push(`  return PRIVACY_POLICY_SECTIONS.filter((section) => {`);
out.push(`    const haystack = \`\${section.number} \${section.title} \${section.body}\`.toLowerCase();`);
out.push(`    return haystack.includes(q);`);
out.push(`  });`);
out.push(`}`);
out.push(``);

const target = path.join(process.cwd(), "constants", "privacyPolicy.ts");
fs.writeFileSync(target, out.join("\n"), "utf8");
console.log(`Wrote ${sections.length} sections to ${target}`);
