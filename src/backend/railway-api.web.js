import { fetch } from 'wix-fetch';

const RAILWAY_URL = 'https://linkifico-v5-production.up.railway.app';

// Test Railway connection - Web Method
export async function testRailwayConnection() {
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
}

// Analyze project via Railway - Web Method
export async function analyzeProjectViaRailway(projectData) {
    try {
        const response = await fetch(`${RAILWAY_URL}/api/analyze-project`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ projectData })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        return {
            success: true,
            message: 'Analysis completed via Railway',
            data: data,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        return {
            success: false,
            message: 'Analysis failed',
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
}

// Generic Railway API call - Web Method
export async function callRailwayAPI(endpoint, method = 'GET', data = null) {
    try {
        const fetchConfig = {
            method,
            headers: {
                'Content-Type': 'application/json'
            }
        };
        
        if (data) {
            fetchConfig.body = JSON.stringify(data);
        }
        
        const response = await fetch(`${RAILWAY_URL}${endpoint}`, fetchConfig);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const responseData = await response.json();
        
        return {
            success: true,
            data: responseData,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        return {
            success: false,
            message: 'Railway API call failed',
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
}
