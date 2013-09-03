var Faye = require('faye');
var cradle = require('cradle');
var http = require('http')
var persona = require('./persona');
var crypto = require('crypto')
// var db = new(cradle.Connection)(process.env.COUCH_IP,
//                                 process.env.COUCH_PORT,
//                                 {auth: {username: process.env.COUCH_USERNAME, 
//                                         password: process.env.COUCH_PASSWORD}}
//                                ).database('dspace-elevate')

var savedState = {};

/*
 * Extension to persist data
 * http://faye.jcoglan.com/node/extensions.html
 */
var persistData = {
  incoming: function(message, callback){

    // ignore meta messages
    if(message.channel.match(/\/meta\/*/)){
      return callback(message);
    };

    // persist message
    message.ext = {};
    message.ext.saved_at = new Date().getTime();
    db.save(message, function(err, res){
      if(err) console.log(err);
    });

    // call the server back
    callback(message);
  }
};

tokens = {}

var authentication = {
  incoming : function(message, callback){
    //handiling subscriptions
    if(message.channel == '/meta/subscribe' ){

//      console.log(message)
      var msgSubscription = message.subscription;
      var msgToken = message.ext && message.ext.token;
      var subscriptions = tokens[msgToken]
      if( ! subscriptions ||  subscriptions.indexOf(msgSubscription) == -1 )  {
        message.error = "not allowed to subscribe to this channel";
        console.log('rejected : ', message)
      }
    }
    callback(message);
  }
  //no outgoing messages needs to be handled I assume when you can't subscribe uit will never send anything
  // but maybe we have to prevent faye to propagate to channels of higher levels let's see
  // outgoing : function(message, callback){

  // }
}

var rememberState = {
  incoming: function(message, callback) {
    if(! message.channel.match(/^\/meta\//)) {
      if(! savedState[message.channel]) 
        savedState[message.channel] = {};
      savedState[message.channel][message.nickname] = message;
    }
    callback(message);
  },

  outgoing: function(message, callback) {
    if(message.channel == '/meta/subscribe' && message.successful) {
      if(! message.ext) message.ext = {};
      if(message.subscription in savedState) {
        var channelState = savedState[message.subscription];
        message.ext.initialState = Object.keys(channelState).map(function(nickname) {
          return channelState[nickname];
        });
      } else {
        message.ext.initialState = [];
      }
    }
    callback(message);
  }
}

var bayeux = new Faye.NodeAdapter({mount: '/faye'});
//bayeux.addExtension(persistData);
bayeux.addExtension(rememberState);
bayeux.addExtension(authentication);

var CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST',
  'Access-Control-Allow-Headers': 'Origin, Content-Type',
  'Access-Control-Expose-Headers': 'Content-Type, Content-Length'
};

var server = http.createServer(function(request, response) {
  console.log('REQUEST', request.method, request.url);
  switch(request.method) {
  case 'OPTIONS':
    response.writeHead(204, CORS_HEADERS);
    response.end();
    break;
  case 'POST':
    if(request.url == '/auth')
      persona.auth(request, function(error, persona_response){
        if(error) {
          console.error("Persona Failed : ", error.message);
          response.writeHead(401, CORS_HEADERS);
          response.write(error);
          response.end();
        } else {
          console.log("Here we are Now, Authenticated");
          crypto.randomBytes(32, function(err, buf) {
            if(err) {
              response.writeHead(500, CORS_HEADERS);
              response.write(err);
              response.end();
            } else {
              var token = buf.toString('base64');
              tokens[token] = ['/dspace'];
              var headers = {
                'Content-Type': 'application/json'
              };
              for(var key in CORS_HEADERS) {
                headers[key] = CORS_HEADERS[key];
              }
              response.writeHead(200, headers);
              response.write(JSON.stringify({
                persona_response: persona_response,
                token: token
              }));
              response.end();
            }
          });
        }
      });
    break;
  }
});

bayeux.attach(server);
server.listen(5000, function() {
  console.log('listening on 5000');
});
