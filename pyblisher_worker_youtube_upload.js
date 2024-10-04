require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const { upload } = require('youtube-videos-uploader'); // vanilla javascript
const fs = require('fs');
const axios = require('axios');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const workdir = process.env.WORK_DIR;
const supabase = createClient(supabaseUrl, supabaseKey);

puppeteer.use(StealthPlugin());

// Puppeteer launch options for YouTube upload
const launchOptions = {
    headless: false, // Set to true if you want to run in headless mode
    defaultViewport: null, // Use the default viewport size
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-infobars',
        '--disable-extensions',
        '--disable-gpu',
        '--window-size=1920,1080',
        '--ignore-certificate-errors',
        '--enable-features=NetworkService,NetworkServiceInProcess'
    ],
};

// Function to fetch channel credentials based on channel ID
async function fetchData(channelId) {
    try {
        const { data: channelCredentials, error: channelError } = await supabase
            .from('youtube_channel_credentials')
            .select('*')
            .eq('id', channelId)
            .single();

        if (channelError) throw channelError;

        return channelCredentials || null;
    } catch (error) {
        console.error('Error fetching data:', error.message);
        return null; // Return null in case of an error
    }
}

// Function to handle actions on video upload success and update the youtube_video record
const onVideoUploadSuccess = async (videoUrl, videoId) => {
    console.log(`Video uploaded successfully! URL: ${videoUrl}`);

    const { data, error } = await supabase
        .from('youtube_video')
        .update({ youtube_id: videoUrl }) // Assuming youtube_id is where you want to store the video_url
        .eq('id', videoId); // Use the video's unique ID to identify which record to update

    if (error) {
        console.error('Error updating youtube_video record:', error.message);
    } else {
        console.log('Successfully updated youtube_video record:', data);
    }
};

// Function to download a file from a URL to a local path
const download_file = async (url_to_download, local_path) => {
    try {
        const response = await axios({
            method: 'get',
            url: url_to_download,
            responseType: 'stream',
        });

        const writer = fs.createWriteStream(local_path);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
    } catch (error) {
        console.error('Error downloading file:', error.message);
    }
};

// Function to subscribe to new records in the youtube_video table
function subscribeToNewVideos() {
    const channel = supabase
        .channel('schema-db-changes') // You can name your channel as needed
        .on('postgres_changes', 
            { event: 'INSERT', schema: 'public', table: 'youtube_video' }, 
            async (payload) => {
                const newVideo = payload.new; // Contains the new record data
                console.log('New video added:', newVideo);

                const { id, process_id, youtube_title, youtube_description, youtube_keywords,
                        youtube_category, file_identifier, thumbnail_identifier,
                        created_at, youtube_privacy_status, channel_id } = newVideo;

                console.log(`Video ID: ${id}`);
                console.log(`Title: ${youtube_title}`);
                console.log(`Description: ${youtube_description}`);
                console.log(`Keywords: ${youtube_keywords}`);
                console.log(`Category: ${youtube_category}`);
                console.log(`File Identifier: ${file_identifier}`);
                console.log(`Thumbnail Identifier: ${thumbnail_identifier}`);
                console.log(`Created At: ${created_at}`);

                // Fetch the corresponding channel credentials using the channel_id
                const channelCredentials = await fetchData(channel_id);

                if (channelCredentials) {
                    const { user_login_email, user_password, user_recovery_email, name } = channelCredentials;

                    const credentials = {
                        email: user_login_email || '',
                        pass: user_password || '',
                        recoveryemail: user_recovery_email || ''
                    };

                    console.log('Channel Credentials:', credentials);

                    // Prepare for video upload
                    const urlToDownload = newVideo.file_identifier; // URL of the file to download
                    const tmp_path_to_video = path.join(workdir, `${newVideo.process_id}.mp4`); // Local path for saving

                    await download_file(urlToDownload, tmp_path_to_video); // Call download_file function

                    const tag_array = youtube_keywords.split(',');
                    const videoAttributes = {
                        path: tmp_path_to_video,
                        title: youtube_title,
                        description: youtube_description,
                        language: 'english', // Adjust based on your logic
                        tags: tag_array,
                        playlist: '', // Adjust as necessary
                        channelName: name,
                        onSuccess: onVideoUploadSuccess,
                        skipProcessingWait: true,
                        onProgress: (progress) => { console.log('progress', progress); },
                        uploadAsDraft: false,
                        isAgeRestriction: false,
                        isNotForKid: false,
                        publishType: youtube_privacy_status.toUpperCase(),
                        isChannelMonetized: false,
                    };

                    console.log('Submitting the metadata to upload:', videoAttributes);
                    
                    // Upload using youtube-video-uploader package
                    //   upload(credentials, [videoAttributes], {headless:false})                 
                    upload(credentials, [videoAttributes], launchOptions)                 
                        .then(console.log)
                        .catch(err => console.error("Upload failed:", err));
                } else {
                    console.log('No channel credentials found for the given channel ID.');
                }
            }
        )
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                console.log('Successfully subscribed to new videos!');
            } else {
                console.error('Failed to subscribe:', status);
            }
        });

    // Graceful shutdown on process exit
    process.on('SIGINT', async () => {
        await supabase.removeChannel(channel);
        console.log('Unsubscribed from new videos. Exiting...');
        process.exit(0);
    });
}

// Call the function to start listening for new records
subscribeToNewVideos();