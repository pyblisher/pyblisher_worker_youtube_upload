// fetchData.js
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function fetchData(id) {
    try {
        // Fetch data from youtube_channel_credentials table
        const { data: channelCredentials, error: channelError } = await supabase
            .from('youtube_channel_credentials')
            .select('*').eq('id', id).single();

        if (channelError) throw channelError;

        console.log('YouTube Channel Credentials:', channelCredentials);
    } catch (error) {
        console.error('Error fetching data:', error.message);
    }
}

fetchData(3);
