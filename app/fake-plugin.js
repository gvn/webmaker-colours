var addon = {
  port: {
   on: function (type, callback) {
    request = new XMLHttpRequest;
    request.open('GET', 'mock2.json', true);
    request.send();

    request.onload = function() {
      data = JSON.parse(this.response);
      callback.call(window, data);
    };
   },
   emit: function (type) {

   }
  }
};
