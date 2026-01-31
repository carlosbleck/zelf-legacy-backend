import Mailgun from 'mailgun.js';
import formData from 'form-data';

// Lazy initialization of Mailgun client
let mg = null;
function getMailgunClient() {
    if (!mg) {
        const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY;
        const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN;

        if (!MAILGUN_API_KEY || !MAILGUN_DOMAIN) {
            throw new Error('MAILGUN_API_KEY and MAILGUN_DOMAIN must be set in .env file');
        }

        const mailgun = new Mailgun(formData);
        mg = mailgun.client({
            username: 'api',
            key: MAILGUN_API_KEY
        });
    }
    return mg;
}

// Get domain from environment
function getMailgunDomain() {
    const domain = process.env.MAILGUN_DOMAIN;
    if (!domain) {
        throw new Error('MAILGUN_DOMAIN must be set in .env file');
    }
    return domain;
}

/**
 * Send an email using Mailgun.
 * 
 * @param {string} to - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} text - Plain text body
 * @param {string} html - Optional HTML body
 * @returns {Promise<object>} - Mailgun response
 */
export async function sendEmail(to, subject, text, html = null) {
    const messageData = {
        from: `Zelf Legacy <noreply@${MAILGUN_DOMAIN}>`,
        to: [to],
        subject: subject,
        text: text
    };

    if (html) {
        messageData.html = html;
    }

    console.log(`📧 Sending email to ${to}...`);
    console.log(`   Subject: ${subject}`);

    try {
        const result = await getMailgunClient().messages.create(getMailgunDomain(), messageData);
        console.log(`✅ Email sent! ID: ${result.id}`);
        return result;
    } catch (error) {
        console.error(`❌ Failed to send email: ${error.message}`);
        throw error;
    }
}

/**
 * Send inheritance notification email to beneficiary.
 * 
 * @param {string} beneficiaryEmail - Beneficiary's email
 * @param {string} tagName - The inheritance tag name for retrieval
 * @param {string} testatorName - Optional name of the testator
 * @param {boolean} isExpired - Whether the will has expired (changes the message tone)
 * @returns {Promise<object>} - Mailgun response
 */
export async function sendInheritanceNotification(beneficiaryEmail, tagName, testatorName = 'Someone', isExpired = false) {
    const subject = isExpired
        ? '🕊️ Inheritance Available - Zelf Legacy'
        : '🔐 An Inheritance Plan Has Been Created For You - Zelf Legacy';

    const introMessage = isExpired
        ? 'We are very sorry for your loss. An inheritance plan has been created for you, and you can now access its assets.'
        : 'We never want anything bad to happen, but an inheritance plan has been created for you in case it\'s needed in the future.';

    const text = `
Hello,

${introMessage}

To accept the will, please follow these steps:

1. Download Zelf from the Play Store.
2. Enter the following tagName: ${tagName}
3. Authenticate using face verification.
4. On the main screen, tap the center bottom button.
5. Select "Accept Inheritance" and follow the instructions.

Once completed, you'll be able to access your funds.

Please keep this email safe for future reference.

Best regards,
The Zelf Legacy Team
    `.trim();

    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        .selectable {
            -webkit-user-select: all;
            -moz-user-select: all;
            -ms-user-select: all;
            user-select: all;
            cursor: pointer;
        }
    </style>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0a0a0f; color: #e0e0e0; margin: 0; padding: 20px;">
    <div style="max-width: 600px; margin: 0 auto; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 20px; padding: 0; border: 1px solid rgba(255,255,255,0.1); overflow: hidden;">
        
        <!-- Header with Gradient -->
        <div style="background: linear-gradient(135deg, #00d9ff 0%, #7b2cbf 100%); padding: 40px 32px; text-align: center;">
            <div style="font-size: 48px; margin-bottom: 12px;">${isExpired ? '🕊️' : '🔐'}</div>
            <h1 style="color: #ffffff; font-size: 26px; margin: 0; font-weight: 700; text-shadow: 0 2px 4px rgba(0,0,0,0.2);">Zelf Legacy</h1>
            <p style="color: rgba(255,255,255,0.9); margin-top: 8px; font-size: 14px; letter-spacing: 1px; text-transform: uppercase;">${isExpired ? 'Inheritance Available' : 'Digital Inheritance Plan'}</p>
        </div>
        
        <!-- Main Content -->
        <div style="padding: 40px 32px;">
            <p style="font-size: 16px; line-height: 1.7; color: #e0e0e0; margin: 0 0 24px 0;">
                ${introMessage}
            </p>
            
            <!-- Tag Name Display -->
            <div style="background: linear-gradient(135deg, rgba(0, 217, 255, 0.15) 0%, rgba(123, 44, 191, 0.15) 100%); border: 1px solid rgba(0, 217, 255, 0.3); border-radius: 16px; padding: 28px; margin: 28px 0; text-align: center;">
                <p style="margin: 0 0 8px 0; color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 2px;">Your Inheritance Tag Name (Tap to select)</p>
                <div class="selectable" style="margin: 0; font-size: 22px; font-weight: 700; color: #00d9ff; font-family: 'SF Mono', Monaco, 'Courier New', monospace; word-break: break-all; background: rgba(0,0,0,0.3); padding: 12px 16px; border-radius: 8px; border: 1px dashed rgba(0,217,255,0.4);">
                    ${tagName}
                </div>
            </div>
            
            <!-- Steps Section -->
            <div style="margin: 36px 0;">
                <h2 style="color: #ffffff; font-size: 18px; margin: 0 0 24px 0; font-weight: 600;">
                    <span style="color: #00d9ff;">📋</span> How to Accept the Will
                </h2>
                
                <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 20px;">
                    <tr>
                        <td valign="top" width="48">
                            <div style="background: linear-gradient(135deg, #00d9ff, #7b2cbf); color: #fff; width: 32px; height: 32px; line-height: 32px; border-radius: 50%; text-align: center; font-weight: 700; font-size: 14px;">1</div>
                        </td>
                        <td valign="top" style="padding-top: 4px;">
                            <p style="margin: 0; color: #e0e0e0; font-size: 15px; line-height: 1.5;">
                                <strong>Download Zelf</strong> from the <a href="https://play.google.com/store" style="color: #00d9ff; text-decoration: none;">Play Store</a>
                            </p>
                        </td>
                    </tr>
                </table>

                <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 20px;">
                    <tr>
                        <td valign="top" width="48">
                            <div style="background: linear-gradient(135deg, #00d9ff, #7b2cbf); color: #fff; width: 32px; height: 32px; line-height: 32px; border-radius: 50%; text-align: center; font-weight: 700; font-size: 14px;">2</div>
                        </td>
                        <td valign="top" style="padding-top: 4px;">
                            <p style="margin: 0; color: #e0e0e0; font-size: 15px; line-height: 1.5;">
                                Enter the <strong>tagName</strong> shown above
                            </p>
                        </td>
                    </tr>
                </table>

                <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 20px;">
                    <tr>
                        <td valign="top" width="48">
                            <div style="background: linear-gradient(135deg, #00d9ff, #7b2cbf); color: #fff; width: 32px; height: 32px; line-height: 32px; border-radius: 50%; text-align: center; font-weight: 700; font-size: 14px;">3</div>
                        </td>
                        <td valign="top" style="padding-top: 4px;">
                            <p style="margin: 0; color: #e0e0e0; font-size: 15px; line-height: 1.5;">
                                <strong>Authenticate</strong> using face verification
                            </p>
                        </td>
                    </tr>
                </table>

                <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 20px;">
                    <tr>
                        <td valign="top" width="48">
                            <div style="background: linear-gradient(135deg, #00d9ff, #7b2cbf); color: #fff; width: 32px; height: 32px; line-height: 32px; border-radius: 50%; text-align: center; font-weight: 700; font-size: 14px;">4</div>
                        </td>
                        <td valign="top" style="padding-top: 4px;">
                            <p style="margin: 0; color: #e0e0e0; font-size: 15px; line-height: 1.5;">
                                On the main screen, tap the <strong>center bottom button</strong>
                            </p>
                        </td>
                    </tr>
                </table>

                <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 20px;">
                    <tr>
                        <td valign="top" width="48">
                            <div style="background: linear-gradient(135deg, #00d9ff, #7b2cbf); color: #fff; width: 32px; height: 32px; line-height: 32px; border-radius: 50%; text-align: center; font-weight: 700; font-size: 14px;">5</div>
                        </td>
                        <td valign="top" style="padding-top: 4px;">
                            <p style="margin: 0; color: #e0e0e0; font-size: 15px; line-height: 1.5;">
                                Select <strong>"Accept Inheritance"</strong> and follow the instructions
                            </p>
                        </td>
                    </tr>
                </table>
            </div>
            
            <!-- Success Message -->
            <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 12px; padding: 20px; margin: 28px 0; text-align: center;">
                <p style="margin: 0; color: #10b981; font-size: 15px; font-weight: 500;">
                    ✅ Once completed, you'll be able to access your funds
                </p>
            </div>
            
            <!-- Important Notice -->
            <div style="background: rgba(251, 191, 36, 0.08); border-left: 4px solid #fbbf24; padding: 16px 20px; margin: 28px 0; border-radius: 0 12px 12px 0;">
                <p style="margin: 0; color: #fbbf24; font-size: 14px; line-height: 1.6;">
                    <strong>📌 Important:</strong> Please keep this email safe for future reference. You will need the tagName above to claim the inheritance.
                </p>
            </div>
        </div>
        
        <!-- Footer -->
        <div style="background: rgba(0,0,0,0.3); padding: 24px 32px; text-align: center; border-top: 1px solid rgba(255,255,255,0.05);">
            <p style="font-size: 13px; color: #666; margin: 0 0 8px 0;">
                Best regards,<br>
                <strong style="color: #888;">The Zelf Legacy Team</strong>
            </p>
            <p style="font-size: 11px; color: #444; margin: 12px 0 0 0;">
                This is an automated message. Please do not reply to this email.
            </p>
        </div>
    </div>
</body>
</html>
    `.trim();

    return sendEmail(beneficiaryEmail, subject, text, html);
}

export default {
    sendEmail,
    sendInheritanceNotification
};
