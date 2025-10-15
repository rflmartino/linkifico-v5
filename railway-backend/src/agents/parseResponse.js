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
    let cleanContent = contentText
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    
    // Fix common JavaScript object notation issues
    cleanContent = fixJavaScriptObjectNotation(cleanContent);
    
    return JSON.parse(cleanContent);
  } catch (error) {
    console.error("Failed to parse response content:", error);
    console.error("Response content type:", typeof response.content);
    console.error("Response content:", response.content);
    throw error;
  }
}

function fixJavaScriptObjectNotation(content) {
  // Fix JavaScript string concatenation in responseText
  // Convert: responseText: "text" + '\n' + "more text"
  // To: responseText: "text\nmore text"
  
  let fixed = content;
  
  // Handle responseText field with string concatenation
  const responseTextMatch = fixed.match(/"responseText":\s*"([^"]*)"\s*\+\s*['"`]([^'"`]*)['"`]\s*\+\s*"([^"]*)"/);
  if (responseTextMatch) {
    const [, part1, part2, part3] = responseTextMatch;
    const concatenatedText = part1 + part2 + part3;
    fixed = fixed.replace(responseTextMatch[0], `"responseText": "${concatenatedText}"`);
  }
  
  // Handle multiple string concatenations in responseText
  const multiConcatenationMatch = fixed.match(/"responseText":\s*"([^"]*)"\s*\+\s*['"`]([^'"`]*)['"`]\s*\+\s*"([^"]*)"\s*\+\s*['"`]([^'"`]*)['"`]\s*\+\s*"([^"]*)"/);
  if (multiConcatenationMatch) {
    const [, part1, part2, part3, part4, part5] = multiConcatenationMatch;
    const concatenatedText = part1 + part2 + part3 + part4 + part5;
    fixed = fixed.replace(multiConcatenationMatch[0], `"responseText": "${concatenatedText}"`);
  }
  
  // Handle even more complex concatenations (up to 8 parts)
  const complexMatch = fixed.match(/"responseText":\s*"([^"]*)"\s*\+\s*['"`]([^'"`]*)['"`]\s*\+\s*"([^"]*)"\s*\+\s*['"`]([^'"`]*)['"`]\s*\+\s*"([^"]*)"\s*\+\s*['"`]([^'"`]*)['"`]\s*\+\s*"([^"]*)"\s*\+\s*['"`]([^'"`]*)['"`]\s*\+\s*"([^"]*)"/);
  if (complexMatch) {
    const [, part1, part2, part3, part4, part5, part6, part7, part8] = complexMatch;
    const concatenatedText = part1 + part2 + part3 + part4 + part5 + part6 + part7 + part8;
    fixed = fixed.replace(complexMatch[0], `"responseText": "${concatenatedText}"`);
  }
  
  // Fix single quotes to double quotes in JSON
  fixed = fixed.replace(/'/g, '"');
  
  // Fix unquoted property names
  fixed = fixed.replace(/(\w+):/g, '"$1":');
  
  // Fix trailing commas before closing braces/brackets
  fixed = fixed.replace(/,(\s*[}\]])/g, '$1');
  
  return fixed;
}

