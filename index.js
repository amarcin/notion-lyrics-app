import { Client, iteratePaginatedAPI } from "@notionhq/client"
import { config } from "dotenv"
import { getLyrics, getSong } from 'genius-lyrics-api';

config()

const pageId = process.env.NOTION_PAGE_ID
const apiKey = process.env.NOTION_API_KEY
const geniusApiKey = process.env.GENIUS_API_KEY

const notion = new Client({ auth: apiKey })

/* 
---------------------------------------------------------------------------
*/

// Take rich text array from a block child that supports rich text and return the plain text.
// Note: All rich text objects include a plain_text field.
const getPlainTextFromRichText = richText => {
  return richText.map(t => t.plain_text).join("")
  // Note: A page mention will return "Undefined" as the page name if the page has not been shared with the integration. See: https://developers.notion.com/reference/block#mention
}

// Use the source URL and optional caption from media blocks (file, video, etc.)
const getMediaSourceText = block => {
  let source, caption

  if (block[block.type].external) {
    source = block[block.type].external.url
  } else if (block[block.type].file) {
    source = block[block.type].file.url
  } else if (block[block.type].url) {
    source = block[block.type].url
  } else {
    source = "[Missing case for media block types]: " + block.type
  }
  // If there's a caption, return it with the source
  if (block[block.type].caption.length) {
    caption = getPlainTextFromRichText(block[block.type].caption)
    return caption + ": " + source
  }
  // If no caption, just return the source URL
  return source
}

// Get the plain text from any block type supported by the public API.
const getTextFromBlock = block => {
  let text

  // Get rich text from blocks that support it
  if (block[block.type].rich_text) {
    // This will be an empty string if it's an empty line.
    text = getPlainTextFromRichText(block[block.type].rich_text)
  }
  // Get text for block types that don't have rich text
  else {
    switch (block.type) {
      case "unsupported":
        // The public API does not support all block types yet
        text = "[Unsupported block type]"
        break
      case "bookmark":
        text = block.bookmark.url
        break
      case "child_database":
        text = block.child_database.title
        // Use "Query a database" endpoint to get db rows: https://developers.notion.com/reference/post-database-query
        // Use "Retrieve a database" endpoint to get additional properties: https://developers.notion.com/reference/retrieve-a-database
        break
      case "child_page":
        text = block.child_page.title
        break
      case "embed":
      case "video":
      case "file":
      case "image":
      case "pdf":
        text = getMediaSourceText(block)
        break
      case "equation":
        text = block.equation.expression
        break
      case "link_preview":
        text = block.link_preview.url
        break
      case "synced_block":
        // Provides ID for block it's synced with.
        text = block.synced_block.synced_from
          ? "This block is synced with a block with the following ID: " +
          block.synced_block.synced_from[block.synced_block.synced_from.type]
          : "Source sync block that another blocked is synced with."
        break
      case "table":
        // Only contains table properties.
        // Fetch children blocks for more details.
        text = "Table width: " + block.table.table_width
        break
      case "table_of_contents":
        // Does not include text from ToC; just the color
        text = "ToC color: " + block.table_of_contents.color
        break
      case "breadcrumb":
      case "column_list":
      case "divider":
        text = "No text available"
        break
      default:
        text = "[Needs case added]"
        break
    }
  }
  // Blocks with the has_children property will require fetching the child blocks. (Not included in this example.)
  // e.g. nested bulleted lists
  if (block.has_children) {
    // For now, we'll just flag there are children blocks.
    text = text + " (Has children)"
  }
  // Includes block type for readability. Update formatting as needed.
  return text //used to be: return block.type + ": " + text
}

async function retrieveBlockChildren(id) {
  const blocks = []

  // Use iteratePaginatedAPI helper function to get all blocks first-level blocks on the page
  for await (const block of iteratePaginatedAPI(notion.blocks.children.list, {
    block_id: id, // A page ID can be passed as a block ID: https://developers.notion.com/docs/working-with-page-content#modeling-content-as-blocks
  })) {
    blocks.push(block)
  }

  return blocks
}

const printBlockText = blocks => {
  console.log("Displaying blocks:")

  for (let i = 0; i < blocks.length; i++) {
    const text = getTextFromBlock(blocks[i])
    // Print plain text for each block.
    console.log(text)
  }
}

async function collectBlockText(blocks) {
  let collectedText = ''
  for (let i = 0; i < blocks.length; i++) {
    const text = getTextFromBlock(blocks[i])
    // collect it into one string
    collectedText += text + '\n';
  }
  return (collectedText)
}

function retrieveSongRequest(text) {
  // Split the string into lines
  const lines = text.split('\n');
  let songLine = [];
  // Iterate over each line
  for (const line of lines) {
    // Find the index of the semicolon in the current line
    const semicolonIndex = line.indexOf(';');

    // If a semicolon is found, extract and add the text before it to songLine
    if (semicolonIndex !== -1) {
      songLine.push(line.substring(0, semicolonIndex));
    }
  }
  songLine = songLine.join()

  // Split the input string by the delimiter ' - '
  const parts = songLine.split(' - ');

  // Initialize variables for song title and artist
  let songTitle = parts[0]; // The part before the dash is always the title
  let songArtist = ''; // Default artist is an empty string

  // If there are two parts, the second part is the artist
  if (parts.length > 1) {
    songArtist = parts[1];
  }
  return {
    songTitle: songTitle.trim(),
    songArtist: songArtist.trim()
  };
}

function retrieveLyrics(song, artist) {
  const options = {
    apiKey: geniusApiKey,
    title: song,
    artist: artist,
    optimizeQuery: true
  };

  // Return the Promise  
  return getLyrics(options).then((lyrics) => {
    return lyrics;
  });
}

async function writeLyrics(id, str) {
  const maxChunkSize = 1999; // Ensure each chunk is less than 2000 characters  

  // Split the string into chunks  
  const chunks = [];
  for (let i = 0; i < str.length; i += maxChunkSize) {
    chunks.push(str.slice(i, i + maxChunkSize));
  }

  // Append each chunk as a separate paragraph block  
  for (const chunk of chunks) {
    await notion.blocks.children.append({
      block_id: id,
      children: [
        {
          paragraph: {
            rich_text: [
              {
                text: {
                  content: chunk, // Append chunk to Notion  
                },
              },
            ],
          },
        },
      ],
    });
  }
}

async function main() {
  const checkForTriggerAndWriteLyrics = async () => {
    // Make API call to retrieve all block children from the page  
    const blocks = await retrieveBlockChildren(pageId);
    // Collect page plain text from each block in a string.  
    const collectedText = await collectBlockText(blocks);
    // Check if it contains the trigger  
    if (collectedText.includes(';')) {
      console.log('Trigger found.');
      // Retrieve the title of the song from the collected text.  
      const songRequest = retrieveSongRequest(collectedText);

      // Using the song title/artist, call the Genius API to retrieve the lyrics  
      const lyrics = await retrieveLyrics(songRequest.songTitle, songRequest.songArtist);
      writeLyrics(pageId, lyrics);

      // Stop the interval once the lyrics are written  
      //clearInterval(intervalId);
    } else {
      console.log('Trigger not found, checking again...');
    }
  };

  setInterval(checkForTriggerAndWriteLyrics, 8000);
}


main()
