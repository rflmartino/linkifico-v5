import { fetch } from 'wix-fetch';
import { Permissions, webMethod } from 'wix-web-module';

const RAILWAY_URL = 'https://linkifico-v5-production.up.railway.app';

// Web Method: Test Railway connection
export const testRailwayConnection = webMethod(Permissions.Anyone, async () => {
    try {
        const response = await fetch(`${RAILWAY_URL}/health`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        return {
            success: true,
            message: 'Railway connection successful',
            data: data,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        return {
            success: false,
            message: 'Railway connection failed',
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
});
