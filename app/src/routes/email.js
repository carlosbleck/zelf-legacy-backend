import { Router } from 'express';
import { sendEmail, sendInheritanceNotification } from '../services/email.js';

const router = Router();

/**
 * POST /api/email/send
 * 
 * Generic endpoint to send an email.
 * 
 * Request body:
 * - to: string (recipient email)
 * - subject: string
 * - text: string (plain text body)
 * - html: string (optional HTML body)
 */
router.post('/send', async (req, res) => {
    try {
        const { to, subject, text, html } = req.body;

        if (!to || !subject || !text) {
            return res.status(400).json({
                error: 'to, subject, and text are required',
                success: false
            });
        }

        const result = await sendEmail(to, subject, text, html);

        res.json({
            success: true,
            messageId: result.id,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Send email failed:', error);
        res.status(500).json({
            error: error.message || 'Failed to send email',
            success: false
        });
    }
});

/**
 * POST /api/email/inheritance-notification
 * 
 * Send an inheritance notification email to a beneficiary.
 * 
 * Request body:
 * - beneficiaryEmail: string (recipient email)
 * - tagName: string (the inheritance tag name)
 * - testatorName: string (optional, name of the testator)
 */
router.post('/inheritance-notification', async (req, res) => {
    try {
        const { beneficiaryEmail, tagName, testatorName } = req.body;

        if (!beneficiaryEmail || !tagName) {
            return res.status(400).json({
                error: 'beneficiaryEmail and tagName are required',
                success: false
            });
        }

        console.log(`\n📨 Inheritance Notification Request`);
        console.log(`   Beneficiary Email: ${beneficiaryEmail}`);
        console.log(`   Tag Name: ${tagName}`);

        const result = await sendInheritanceNotification(
            beneficiaryEmail,
            tagName,
            testatorName || 'Someone'
        );

        res.json({
            success: true,
            messageId: result.id,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Inheritance notification failed:', error);
        res.status(500).json({
            error: error.message || 'Failed to send inheritance notification',
            success: false
        });
    }
});

export { router as emailRouter };
