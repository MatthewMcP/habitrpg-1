'use strict';

angular.module('habitrpg').factory('Payments',
['$rootScope', 'User', '$http', 'Content',
function($rootScope, User, $http, Content) {
  var Payments = {};
  var isAmazonReady = false;

  window.onAmazonLoginReady = function(){
    isAmazonReady = true;
    amazon.Login.setClientId(window.env.AMAZON_PAYMENTS.CLIENT_ID);
  };

  Payments.showStripe = function(data) {
    var sub =
      data.subscription ? data.subscription
        : data.gift && data.gift.type=='subscription' ? data.gift.subscription.key
        : false;
    sub = sub && Content.subscriptionBlocks[sub];
    var amount = // 500 = $5
      sub ? sub.price*100
        : data.gift && data.gift.type=='gems' ? data.gift.gems.amount/4*100
        : 500;
    StripeCheckout.open({
      key: window.env.STRIPE_PUB_KEY,
      address: false,
      amount: amount,
      name: 'HabitRPG',
      description: sub ? window.env.t('subscribe') : window.env.t('checkout'),
      image: "/apple-touch-icon-144-precomposed.png",
      panelLabel: sub ? window.env.t('subscribe') : window.env.t('checkout'),
      token: function(res) {
        var url = '/stripe/checkout?a=a'; // just so I can concat &x=x below
        if (data.gift) url += '&gift=' + Payments.encodeGift(data.uuid, data.gift);
        if (data.subscription) url += '&sub='+sub.key;
        if (data.coupon) url += '&coupon='+data.coupon;
        $http.post(url, res).success(function() {
          window.location.reload(true);
        }).error(function(res) {
          alert(res.err);
        });
      }
    });
  }

  Payments.showStripeEdit = function(){
    StripeCheckout.open({
      key: window.env.STRIPE_PUB_KEY,
      address: false,
      name: window.env.t('subUpdateTitle'),
      description: window.env.t('subUpdateDescription'),
      panelLabel: window.env.t('subUpdateCard'),
      token: function(data) {
        var url = '/stripe/subscribe/edit';
        $http.post(url, data).success(function() {
          window.location.reload(true);
        }).error(function(data) {
          alert(data.err);
        });
      }
    });
  }

  var amazonOnError = function(error){
    console.error(error);
    console.log(error.getErrorMessage(), error.getErrorCode());
    alert(error.getErrorMessage());
  };

  Payments.amazonPayments = {};

  Payments.amazonPayments.reset = function(){
    Payments.amazonPayments.modal.close();
    // TODO this is needed because if we do not logout
    // users then if they use donation & then subscription 
    // the billing agreement will be wrong
    amazon.Login.logout();
    Payments.amazonPayments.modal = null;
    Payments.amazonPayments.type = null;
    Payments.amazonPayments.loggedIn = false;
    Payments.amazonPayments.gift = null;
    Payments.amazonPayments.orderReferenceId = null;
    Payments.amazonPayments.billingAgreementId = null;
    Payments.amazonPayments.paymentSelected = false;
    Payments.amazonPayments.recurringConsent = false;
  };

  // Needs to be called everytime the modal/router is accessed
  Payments.amazonPayments.init = function(type, gift, giftedTo){
    if(gift){
      if(gift.gems && gift.gems.amount && gift.gems.amount <= 0) return;
      gift.uuid = giftedTo;
    }

    if(!isAmazonReady) return;
    if(type !== 'donation' && type !== 'subscription') return;

    Payments.amazonPayments.gift = gift;
    Payments.amazonPayments.type = type;

    var modal = Payments.amazonPayments.modal = $rootScope.openModal('amazonPayments', {
      // Allow the modal to be closed only by pressing cancel
      // because no easy method to intercept those types of closings
      // and we need to make some cleanup
      keyboard: false,
      backdrop: 'static' 
    });

    modal.rendered.then(function(){
      OffAmazonPayments.Button('AmazonPayButton', window.env.AMAZON_PAYMENTS.SELLER_ID, {
        type:  'PwA',
        color: 'Gold',
        size:  'small',

        authorization: function(){
          amazon.Login.authorize({
            scope: 'payments:widget',
            popup: true
          }, function(response){
            if(response.error) return alert(response.error);

            var url = '/amazon/verifyAccessToken'
            $http.post(url, response).success(function(){
              Payments.amazonPayments.loggedIn = true;
              Payments.amazonPayments.initWidgets();
            }).error(function(res){
              alert(res.err);
            });
          });
        },

        onError: amazonOnError
      });
    });

  }

  Payments.amazonPayments.canCheckout = function(){
    if(Payments.amazonPayments.type === 'donation'){
      return Payments.amazonPayments.paymentSelected === true;
    }else if(Payments.amazonPayments.type === 'subscription'){
      return Payments.amazonPayments.paymentSelected === true && 
              // Mah.. one is a boolean the other a string...
              Payments.amazonPayments.recurringConsent === 'true'; 
    }else{
      return false;
    }
  },

  Payments.amazonPayments.initWidgets = function(){
    var walletParams = {
      sellerId: window.env.AMAZON_PAYMENTS.SELLER_ID,
      design: {
        designMode: 'responsive'
      },

      onPaymentSelect: function(orderReference) {
        $rootScope.$apply(function(){
          Payments.amazonPayments.paymentSelected = true;
        });        
      },

      onError: amazonOnError
    };

    if(Payments.amazonPayments.type === 'donation'){
      walletParams.onOrderReferenceCreate = function(orderReference) {
        Payments.amazonPayments.orderReferenceId = orderReference.getAmazonOrderReferenceId();
      }
    }else if(Payments.amazonPayments.type === 'subscription'){
      walletParams.onReady = function(billingAgreement) {
        Payments.amazonPayments.billingAgreementId = billingAgreement.getAmazonBillingAgreementId();

        new OffAmazonPayments.Widgets.Consent({
          sellerId: window.env.AMAZON_PAYMENTS.SELLER_ID,
          amazonBillingAgreementId: Payments.amazonPayments.billingAgreementId, 
          design: {
            designMode: 'responsive'
          },

          onReady: function(consent){
            $rootScope.$apply(function(){
              Payments.amazonPayments.recurringConsent = consent.getConsentStatus();
            });
          },

          onConsent: function(consent){
            $rootScope.$apply(function(){
              Payments.amazonPayments.recurringConsent = consent.getConsentStatus();
            });
          },

          onError: amazonOnError
        }).bind('AmazonPayRecurring');
      };

      walletParams.agreementType = 'BillingAgreement';
    }

    new OffAmazonPayments.Widgets.Wallet(walletParams).bind('AmazonPayWallet');
  }

  Payments.amazonPayments.checkout = function(){
    if(Payments.amazonPayments.type === 'donation'){
      var url = '/amazon/checkout'
      $http.post(url, {
        orderReferenceId: Payments.amazonPayments.orderReferenceId,
        gift: Payments.amazonPayments.gift
      }).success(function(){
        Payments.amazonPayments.reset();
        window.location.reload(true);
      }).error(function(res){
        alert(res.err);
        Payments.amazonPayments.reset();
      });
    }else if(Payments.amazonPayments.type === 'subscription'){
      return false
    }
  }

  Payments.cancelSubscription = function(){
    if (!confirm(window.env.t('sureCancelSub'))) return;
    window.location.href = '/' + User.user.purchased.plan.paymentMethod.toLowerCase() + '/subscribe/cancel?_id=' + User.user._id + '&apiToken=' + User.user.apiToken;
  }

  Payments.encodeGift = function(uuid, gift){
    gift.uuid = uuid;
    return JSON.stringify(gift);
  }

  return Payments;
}]);
