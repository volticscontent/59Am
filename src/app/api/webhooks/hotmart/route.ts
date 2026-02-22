import { NextResponse } from 'next/server';
import { sendMetaEvent, hashData } from '@/utils/metaCapi';

// Hotmart Webhook Payload Example:
// {
//   "event": "PURCHASE_APPROVED",
//   "data": {
//     "product": { "id": 12345, "name": "Product Name" },
//     "buyer": { "email": "test@test.com", "name": "Test User", "checkout_phone": "11999999999" },
//     "purchase": { "transaction": "HP123456789", "payment": { "type": "CREDIT_CARD" }, "price": { "value": 197.0, "currency_code": "BRL" } }
//   }
// }

export async function POST(request: Request) {
    try {
        const text = await request.text();
        let payload: any = {};

        try {
            payload = JSON.parse(text);
        } catch (e) {
            // Handle URL Encoded fallback if Hotmart sends it in an older format
            const params = new URLSearchParams(text);
            payload = Object.fromEntries(params);
        }

        const event = payload.event;
        const data = payload.data || payload; // Depending on Hotmart version

        // We only care about Approved Purchases for the Purchase event
        if (event !== 'PURCHASE_APPROVED' && event !== 'PURCHASE_COMPLETE') {
            return NextResponse.json({ message: 'Event ignored' }, { status: 200 });
        }

        const transactionId = data.purchase?.transaction || payload.transaction;
        const currency = data.purchase?.price?.currency_code || payload.currency || 'BRL';
        const value = data.purchase?.price?.value || payload.price || 0;

        const buyerEmail = data.buyer?.email || payload.email;
        const buyerName = data.buyer?.name || payload.name;
        const buyerPhone = data.buyer?.checkout_phone || data.buyer?.phone || payload.phone;
        const productId = data.product?.id || payload.product_id;

        const userDataParams: any = {};
        if (buyerEmail) userDataParams.em = hashData(buyerEmail);
        if (buyerPhone) userDataParams.ph = hashData(buyerPhone.toString().replace(/\D/g, ''));
        if (buyerName) {
            const nameParts = buyerName.trim().split(' ');
            if (nameParts.length > 0) userDataParams.fn = hashData(nameParts[0]);
            if (nameParts.length > 1) userDataParams.ln = hashData(nameParts.slice(1).join(' '));
        }

        // Fire Meta CAPI Purchase Event
        await sendMetaEvent({
            eventName: 'Purchase',
            eventSourceUrl: `https://hotmart.com/checkout/${productId}`,
            userIp: null, // Webhook doesn't have the buyer's actual IP
            userAgent: null,
            eventId: transactionId, // Use Hotmart Transaction ID for deduplication
            userData: Object.keys(userDataParams).length > 0 ? userDataParams : undefined,
            customData: {
                currency: currency,
                value: value,
                content_ids: [productId?.toString()],
                content_type: 'product',
            }
        });

        // Fire UTMify Purchase Event (S2S)
        if (process.env.UTMIFY_TOKEN) {
            try {
                // Determine user IP preferring the payload IP
                const userIpForUtmify = payload.ip || null;

                // UTMify requires payload similar to their docs: https://api.utmify.com.br/v1/events
                await fetch('https://api.utmify.com.br/v1/events', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${process.env.UTMIFY_TOKEN}`,
                    },
                    body: JSON.stringify({
                        event: 'Purchase',
                        value: value || 0,
                        transaction_id: transactionId,
                        email: hashData(buyerEmail), // Sending hashed for compliance but UTMify might accept raw
                        phone: hashData(buyerPhone?.toString().replace(/\D/g, '')),
                        // Additional optional parameters can go here, like user agent, ip etc 
                        ...(userIpForUtmify ? { ip: userIpForUtmify } : {})
                    })
                });
                console.log(`UTMify Purchase Event sent for transaction: ${transactionId}`);
            } catch (utmifyError) {
                console.error('Error sending UTMify event:', utmifyError);
            }
        }

        return NextResponse.json({ success: true, transaction: transactionId }, { status: 200 });

    } catch (error: any) {
        console.error('Error processing Hotmart Webhook:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
