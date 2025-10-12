// Helper function to parse LangChain response content
// Handles both string and array content types

export function parseResponseContent(response) {
  try {
    // Handle content as string or array
    let contentText;
    
    if (typeof response.content === 'string') {
      contentText = response.content;
    } else if (Array.isArray(response.content)) {
      if (response.content.length === 0) {
        console.error("❌ Response content is empty array!");
        throw new Error("Response content is empty array");
      }
      // Extract text from content blocks
      contentText = response.content
        .map(block => block.text || block.content || '')
        .join('');
      
      if (!contentText) {
        console.error("❌ Could not extract text from content blocks:", response.content);
        throw new Error("Could not extract text from content array");
      }
    } else {
      console.error("❌ Unexpected content type:", typeof response.content);
      contentText = JSON.stringify(response.content);
    }
    
    console.log(`📦 Extracted content (${contentText.length} chars):`, contentText.substring(0, 200));
    
    // Remove markdown code blocks
    const cleanContent = contentText
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    
    return JSON.parse(cleanContent);
  } catch (error) {
    console.error("Failed to parse response content:", error);
    console.error("Response content type:", typeof response.content);
    console.error("Response content:", response.content);
    throw error;
  }
}

